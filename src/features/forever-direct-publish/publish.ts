/**
 * Owner Direct Publish — the operation itself
 * (FOREVER-STUDIO-OWNER-DIRECT-PUBLISH-001, Phases 1, 3 and 7).
 *
 * upload → process → upsert production → upload public media → publish →
 * return public URL.
 *
 * Guarantees this module is responsible for:
 *   - Owner/Trusted-Publisher only, with explicit source_trust, publication_mode
 *     and production target stamps (never inferred from ambient config).
 *   - A successful run ends PUBLISHED. There is no persisted draft to act on.
 *   - A failed run leaves nothing partially public: the graph write and the
 *     publication are one database transaction, and public media objects are
 *     content-addressed so a retry reuses them instead of duplicating.
 *   - Idempotent by stable slug + source fingerprint. An existing project is
 *     UPDATED, never duplicated; an identical package replays to no new rows.
 *   - Missing optional data publishes as null plus a warning. Only the technical
 *     failures in ./publishability and ./trust can refuse.
 *   - Batch runs are independent: one project failing never rolls back another.
 */

import type {
  ProgressiveBatch,
  ProgressiveBatchSummary,
  ProgressiveMediaItem,
  ProgressiveProjectPayload,
  ProgressiveWarning,
} from "../forever-ingestion/batch-types";
import { fingerprintBatch } from "../forever-ingestion/build-batch";
import { createPublicDerivative } from "../forever-studio/server/media-truth";

import { planPublicMedia, type MediaPlan, type PlannedMediaItem } from "./media-plan";
import { assessPublishability } from "./publishability";
import type { SourcePackage } from "./source-package";
import { assertProductionTarget, type VerifiedTarget } from "./target";
import {
  assertDirectPublishAuthorization,
  isPublicationBlocking,
  PUBLICATION_MODE,
  SOURCE_TRUST,
  type DirectPublishAuthorization,
} from "./trust";

/** Public bucket sanitized image derivatives are uploaded into. */
export const PUBLIC_IMAGE_BUCKET = "project-images";
/** Private bucket the untouched official originals are retained in. */
export const PRIVATE_EVIDENCE_BUCKET = "forever-direct-evidence";

/** Content types `createPublicDerivative` can sanitize and verify. */
const SANITIZABLE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type SanitizableContentType = (typeof SANITIZABLE_CONTENT_TYPES)[number];

const DERIVATIVE_EXTENSION: Record<string, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

/**
 * Content type from the actual leading bytes, restricted to what the sanitizer
 * can verify. Anything else is not published in this lane.
 */
export function detectSanitizableImageType(bytes: Buffer): SanitizableContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export interface DirectPublishSummary extends ProgressiveBatchSummary {
  direct_published?: boolean;
}

export interface PublicMediaUpload {
  bucket: string;
  path: string;
  bytes: Buffer;
  contentType: string;
}

export interface DirectPublishDeps {
  /** Proven production identity. Re-checked here before any write. */
  target: VerifiedTarget;
  /** True when a project with this slug already exists (create vs update). */
  projectExists(slug: string): Promise<boolean>;
  /** Other project slugs, for cross-project contamination exclusion. */
  knownProjectSlugs?(): Promise<readonly string[]>;
  /** Atomic ingest + publish — public.forever_direct_publish. */
  directPublish(
    batch: ProgressiveBatch,
    options: Record<string, string | null>,
  ): Promise<DirectPublishSummary>;
  /** Upload a verified derivative; returns its public URL. */
  uploadPublicMedia(input: PublicMediaUpload): Promise<string>;
  /** Retain the untouched original as private evidence. Optional. */
  retainEvidence?(input: PublicMediaUpload): Promise<void>;
  /** Absolute site origin, when known, so the result can return a full URL. */
  siteOrigin?: string | null;
}

export interface DirectPublishWarning {
  code: string;
  message: string;
}

export interface DirectPublishResult {
  packageRef: string;
  slug: string | null;
  status: "published" | "failed";
  projectId: string | null;
  /** Site-relative page path, e.g. /projects/the-title-legendary. */
  publicPath: string | null;
  /** Absolute URL when the site origin is known, else null. */
  publicUrl: string | null;
  mode: "create" | "enrich" | null;
  counts: ProgressiveBatchSummary["counts"] | null;
  mediaPublished: number;
  mediaRetainedPrivate: number;
  heroPublished: boolean;
  replayed: boolean;
  warnings: DirectPublishWarning[];
  errorCode: string | null;
  error: string | null;
}

export function projectPagePath(slug: string): string {
  return `/projects/${slug}`;
}

function warningSummaries(warnings: readonly ProgressiveWarning[]): DirectPublishWarning[] {
  return warnings.map((warning) => ({ code: warning.code, message: warning.message }));
}

/**
 * Deterministic, content-addressed public object path.
 *
 * Identical bytes always land on the identical path, which is what makes a
 * repeated publish create no second storage object and no second media row.
 */
export function publicMediaPath(slug: string, derivativeSha256: string, format: string): string {
  if (!/^[a-f0-9]{64}$/.test(derivativeSha256)) throw new Error("invalid_derivative_sha256");
  const extension = DERIVATIVE_EXTENSION[format] ?? "jpg";
  return `direct/${slug}/${derivativeSha256.slice(0, 24)}.${extension}`;
}

/** Private evidence path for the untouched original. */
export function evidencePath(slug: string, originalSha256: string): string {
  return `direct/${slug}/originals/${originalSha256.slice(0, 24)}`;
}

const FLAT_PROJECT_KEYS = [
  "name",
  "developer_id",
  "location_id",
  "developer_name_raw",
  "location_name_raw",
  "location_area",
  "project_type",
  "address",
  "short_description",
  "full_description",
  "construction_status",
  "ownership_type",
  "completion_date",
  "latitude",
  "longitude",
  "main_image_url",
  "brochure_url",
  "starting_price_thb",
  "price_range",
] as const;

/**
 * Align the package's declared mode with what the database actually contains.
 *
 * A package authored as `create` must become `enrich` when the slug already
 * exists — otherwise the ingest boundary rejects it as `project_slug_exists`
 * and the Owner would have to hand-edit the payload. This is what makes
 * "publish the same project again with a newer source" just work.
 */
export function adaptBatchMode(batch: ProgressiveBatch, exists: boolean): ProgressiveBatch {
  const project = batch.project;
  if (exists && batch.mode === "enrich") return batch;
  if (!exists && batch.mode === "create") return batch;

  if (exists && batch.mode === "create") {
    const set: Record<string, unknown> = { ...(project.set ?? {}) };
    for (const key of FLAT_PROJECT_KEYS) {
      const value = project[key];
      if (value !== undefined && value !== null) set[key] = value;
    }
    const next: ProgressiveProjectPayload = {
      slug: project.slug,
      set,
      publish: true,
      ...(project.field_provenance ? { field_provenance: project.field_provenance } : {}),
    };
    return rebuild({ ...batch, mode: "enrich", project: next });
  }

  // enrich → create: flatten `set` back into columns for the initial insert.
  const set = (project.set ?? {}) as Record<string, unknown>;
  const flat: Record<string, unknown> = {};
  for (const key of FLAT_PROJECT_KEYS) {
    const value = project[key] ?? set[key];
    if (value !== undefined && value !== null) flat[key] = value;
  }
  const next = {
    slug: project.slug,
    ...flat,
    ...(project.field_provenance ? { field_provenance: project.field_provenance } : {}),
  } as ProgressiveProjectPayload;
  return rebuild({ ...batch, mode: "create", project: next });
}

/** Re-fingerprint a batch whose content this module changed. */
function rebuild(batch: ProgressiveBatch): ProgressiveBatch {
  const { batch_fingerprint: _ignored, ...body } = batch;
  return { ...body, batch_fingerprint: fingerprintBatch(body) } as ProgressiveBatch;
}

interface MediaOutcome {
  media: ProgressiveMediaItem[];
  warnings: ProgressiveWarning[];
  heroUrl: string | null;
  published: number;
  retainedPrivate: number;
}

/**
 * Sanitize, verify and upload the planned media.
 *
 * Only images the sanitizer can fully verify become public. Anything else —
 * PDFs, unsupported formats, images that fail verification — is retained as
 * private evidence with a warning, never published unverified. That boundary is
 * a technical safety check and is deliberately NOT relaxed by the Owner trust
 * decision.
 */
async function publishPlannedMedia(
  deps: DirectPublishDeps,
  slug: string,
  plan: MediaPlan,
  bytesByPath: Map<string, Buffer>,
): Promise<MediaOutcome> {
  const media: ProgressiveMediaItem[] = [];
  const warnings: ProgressiveWarning[] = [...plan.warnings];
  let heroUrl: string | null = null;
  let published = 0;
  let retainedPrivate = 0;

  const retain = async (item: PlannedMediaItem, bytes: Buffer, contentType: string) => {
    retainedPrivate += 1;
    if (!deps.retainEvidence) return;
    try {
      await deps.retainEvidence({
        bucket: PRIVATE_EVIDENCE_BUCKET,
        path: evidencePath(slug, item.sha256),
        bytes,
        contentType,
      });
    } catch {
      // Evidence retention is provenance hygiene, never a publication blocker.
      warnings.push({
        entity: "media",
        code: "evidence_retention_failed",
        severity: "info",
        message: "One official original could not be retained as private evidence just now.",
      });
    }
  };

  for (const item of plan.items) {
    const bytes = bytesByPath.get(item.path);
    if (!bytes) continue;

    const observedContentType = detectSanitizableImageType(bytes);
    if (!observedContentType) {
      await retain(item, bytes, "application/octet-stream");
      warnings.push({
        entity: "media",
        code: "media_not_publishable_format",
        severity: "info",
        message:
          "One official file is not a verifiable public image format; it was retained privately instead of published.",
      });
      continue;
    }

    const derivative = createPublicDerivative({
      bytes,
      originalSha256: item.sha256,
      originalSize: bytes.length,
      observedContentType,
    });
    if (!derivative.eligible) {
      await retain(item, bytes, observedContentType);
      warnings.push({
        entity: "media",
        code: "media_retained_private",
        severity: "info",
        message: `One official image could not be safely sanitized (${derivative.reason}); it was retained privately.`,
      });
      continue;
    }

    const derivativeSha256 = derivative.record.derivative!.sha256;
    const path = publicMediaPath(slug, derivativeSha256, derivative.format);
    let url: string;
    try {
      url = await deps.uploadPublicMedia({
        bucket: PUBLIC_IMAGE_BUCKET,
        path,
        bytes: derivative.bytes,
        contentType: derivative.contentType,
      });
    } catch {
      // A storage failure for one image must not fail the whole publication.
      await retain(item, bytes, observedContentType);
      warnings.push({
        entity: "media",
        code: "media_upload_failed",
        severity: "warning",
        message: "One official image could not be uploaded just now; it was retained privately.",
      });
      continue;
    }

    await retain(item, bytes, observedContentType);
    published += 1;
    if (item.isHero) heroUrl = url;

    // Deliberately minimal public metadata: no sanitizer record, no embedded
    // claims, no source path. Public rows carry presentation data only.
    media.push({
      media_type: item.mediaType,
      url,
      sort_order: item.sortOrder,
    });
  }

  return { media, warnings, heroUrl, published, retainedPrivate };
}

/**
 * Publish one source package directly to production.
 *
 * Never throws for an ordinary failure: it returns a failed result carrying a
 * safe code so a batch run can continue with the next package.
 */
export async function publishProject(
  pkg: SourcePackage,
  deps: DirectPublishDeps,
  authorizationInput: {
    role: string | undefined;
    actorId: string | undefined;
    actorEmail?: string | null;
    sourceTrust?: string;
    publicationMode?: string;
    /**
     * Optional overrides for the planner's default publication caps, so a
     * deliberately curated package can publish more than the unattended default.
     * Omitted means the planner's own defaults apply.
     */
    maxGallery?: number;
    maxPlans?: number;
  },
): Promise<DirectPublishResult> {
  const base: DirectPublishResult = {
    packageRef: pkg.ref,
    slug: pkg.batch.project?.slug ?? null,
    status: "failed",
    projectId: null,
    publicPath: null,
    publicUrl: null,
    mode: null,
    counts: null,
    mediaPublished: 0,
    mediaRetainedPrivate: 0,
    heroPublished: false,
    replayed: false,
    warnings: [],
    errorCode: null,
    error: null,
  };

  let authorization: DirectPublishAuthorization;
  try {
    // 1. Owner / Trusted Publisher with explicit direct-publish stamps.
    authorization = assertDirectPublishAuthorization({
      role: authorizationInput.role,
      sourceTrust: authorizationInput.sourceTrust ?? SOURCE_TRUST,
      publicationMode: authorizationInput.publicationMode ?? PUBLICATION_MODE,
      actorId: authorizationInput.actorId,
      actorEmail: authorizationInput.actorEmail,
    });

    // 2. Prove the write target is production, again, right before writing.
    assertProductionTarget({
      supabaseUrl: deps.target.url,
      requestedTarget: deps.target.target,
    });
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    return {
      ...base,
      errorCode: failure.code ?? "authorization_failed",
      error: failure.message ?? "Authorization failed.",
    };
  }

  try {
    // 3. Minimum publication requirements — the only content-side refusal.
    const verdict = assessPublishability(pkg.batch);
    if (!verdict.ok) {
      return { ...base, errorCode: verdict.failure.code, error: verdict.failure.message };
    }
    const slug = verdict.slug;

    // 4. Create or update? Decided from the live database, not the payload.
    const exists = await deps.projectExists(slug);
    const adapted = adaptBatchMode(pkg.batch, exists);

    // 5. Automatic media selection over the supplied official files.
    const otherSlugs = deps.knownProjectSlugs ? await deps.knownProjectSlugs() : [];
    const plan = planPublicMedia(pkg.media, {
      slug,
      otherProjectSlugs: otherSlugs.filter((candidate) => candidate !== slug),
      maxGallery: authorizationInput.maxGallery,
      maxFloorPlans: authorizationInput.maxPlans,
      // A generated package renamed its files, so the hero policy would find no
      // evidence in their paths. These are the roles the Factory recorded when
      // the original source folders were still visible.
      declaredRoles: pkg.declaredRoles,
    });
    const bytesByPath = new Map(pkg.media.map((candidate) => [candidate.path, candidate.bytes]));

    // 6. Sanitize, verify and upload the public derivatives.
    const mediaOutcome = await publishPlannedMedia(deps, slug, plan, bytesByPath);

    // 7. Assemble the final batch: package warnings + media warnings, hero,
    //    and the explicit publication decision.
    const warnings: ProgressiveWarning[] = [...(adapted.warnings ?? []), ...mediaOutcome.warnings];
    const blocking = warnings.find(isPublicationBlocking);
    if (blocking) {
      return {
        ...base,
        slug,
        errorCode: blocking.code,
        error: blocking.message,
        warnings: warningSummaries(warnings),
      };
    }

    const project: ProgressiveProjectPayload = { ...adapted.project, publish: true };
    if (mediaOutcome.heroUrl) {
      if (adapted.mode === "create") project.main_image_url = mediaOutcome.heroUrl;
      else project.set = { ...(project.set ?? {}), main_image_url: mediaOutcome.heroUrl };
    }

    const finalBatch = rebuild({
      ...adapted,
      project,
      media: [...(adapted.media ?? []), ...mediaOutcome.media],
      warnings,
    });

    // 8. One atomic transaction: graph write + publication.
    const summary = await deps.directPublish(finalBatch, {
      source_trust: authorization.sourceTrust,
      publication_mode: authorization.publicationMode,
      actor_id: authorization.actorId,
      actor_email: authorization.actorEmail ?? null,
      actor_role: authorization.role,
      package_ref: pkg.ref,
      target_project_ref: deps.target.projectRef,
    });

    const publicPath = projectPagePath(summary.project_slug || slug);
    const origin = deps.siteOrigin?.replace(/\/+$/, "") ?? null;
    return {
      packageRef: pkg.ref,
      slug: summary.project_slug || slug,
      status: "published",
      projectId: summary.project_id,
      publicPath,
      publicUrl: origin ? `${origin}${publicPath}` : null,
      mode: adapted.mode,
      counts: summary.counts,
      mediaPublished: mediaOutcome.published,
      mediaRetainedPrivate: mediaOutcome.retainedPrivate,
      heroPublished: Boolean(mediaOutcome.heroUrl),
      replayed: Boolean(summary.replayed),
      warnings: warningSummaries(warnings),
      errorCode: null,
      error: null,
    };
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    return {
      ...base,
      errorCode: failure.code ?? "direct_publish_failed",
      error: failure.message ?? "Direct publication failed.",
    };
  }
}

/**
 * Publish many packages. Each one is fully independent: a failure is reported
 * and the run continues, so one bad package never rolls back a good one.
 */
export async function publishProjects(
  packages: readonly SourcePackage[],
  deps: DirectPublishDeps,
  authorizationInput: Parameters<typeof publishProject>[2],
): Promise<DirectPublishResult[]> {
  const results: DirectPublishResult[] = [];
  for (const pkg of packages) {
    results.push(await publishProject(pkg, deps, authorizationInput));
  }
  return results;
}
