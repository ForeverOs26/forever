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

import {
  assertPlanSemanticRoles,
  planPublicMedia,
  type MediaPlan,
  type PlannedMediaItem,
} from "./media-plan";
import { detectSanitizableImageType, publicMediaPath } from "./public-object-path";
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

/**
 * Object identity moved to ./public-object-path and is re-exported here.
 *
 * `publicMediaPath` and `detectSanitizableImageType` are the only way to
 * recompute a live storage object path from bytes on disk, and the semantic
 * backfill controller — a `.mjs` runner loading TypeScript through jiti — needs
 * both. It cannot load THIS module: `../forever-ingestion/build-batch` above
 * transitively imports `@/import/currency-policy`, and jiti does not resolve
 * tsconfig path aliases, so the import fails before any code runs.
 *
 * Re-exporting rather than duplicating keeps one implementation. A second copy
 * of the path rule would eventually address a different storage object than the
 * publish lane wrote, which is precisely how a role gets written onto a row
 * depicting something else.
 */
export {
  detectSanitizableImageType,
  publicMediaPath,
  DERIVATIVE_EXTENSION,
  SANITIZABLE_CONTENT_TYPES,
  type SanitizableContentType,
} from "./public-object-path";

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
    //
    // `semantic_role` joins that set. It is what the Factory already decided the
    // image depicts, drawn from a closed seventeen-value vocabulary — a
    // presentation fact, not provenance. Without it the browser receives a
    // content-addressed URL and an empty title, and cannot tell a launch-party
    // photograph from a pool render; with it, the gallery can exclude by
    // evidence instead of by guessing at filenames.
    //
    // Omitted rather than written as null when the planner recorded no role, so
    // an unclassified item is indistinguishable from a pre-contract row and
    // both are treated the same way by readers.
    media.push({
      media_type: item.mediaType,
      url,
      sort_order: item.sortOrder,
      ...(item.semanticRole ? { semantic_role: item.semanticRole } : {}),
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

    // Before a single byte is uploaded. The database enforces the same
    // vocabulary, but a CHECK violation arrives after the images are already in
    // public storage: the write fails and the bytes stay.
    assertPlanSemanticRoles(plan);

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
    } else if (warnings.some((warning) => warning.code === "hero_candidate_missing")) {
      // The policy did not merely find no photograph — it looked at the ones
      // supplied and determined that none depicts the property. Leaving the
      // stored cover in place would keep showing the very image just rejected,
      // which would make `hero_candidate_missing` a report with no effect.
      //
      // Deliberately narrow: a run that supplied no publishable photograph at
      // all raises `hero_image_missing` instead and is not matched here, so a
      // price-only or document-only enrichment can never clear a good cover.
      project.set = { ...(project.set ?? {}), main_image_url: null };
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
