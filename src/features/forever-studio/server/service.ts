/**
 * Forever Studio — server orchestration (FOREVER-STUDIO-001, hardened).
 *
 * One narrow layer between the authenticated publisher and the existing
 * progressive ingestion lane. It reuses — never reimplements — the batch
 * builder, provenance precedence, dependency resolution, and the atomic
 * studio_publish_project / studio_publish_resale transaction functions that
 * compose the unchanged forever_progressive_ingest.
 *
 * Durable product rule enforced here:
 *   An upload by an authenticated Owner or Trusted Publisher IS direct
 *   publication authorization. Incomplete business data never creates a
 *   follow-on approval or publication gate. Missing facts become warnings
 *   and absent fields; unreadable files are retained privately; failures
 *   leave a retryable job that resumes automatically. Every write is
 *   project-isolated, transactional, and idempotent under retry.
 */

import type {
  ProgressiveBatch,
  ProgressiveProjectPayload,
  ProgressiveWarning,
} from "@/features/forever-ingestion/batch-types";
import { fingerprintBatch, buildProgressiveBatch } from "@/features/forever-ingestion/build-batch";
import { buildListingDraft } from "@/features/forever-ingestion/listings";
import {
  canReplaceField,
  type FieldProvenance,
  type FieldProvenanceMap,
  type ProvenanceStatus,
} from "@/features/forever-ingestion/provenance";
import { slugify } from "@/import/persistence-projection";

import {
  projectPagePath,
  resalePagePath,
  STUDIO_WORKFLOWS,
  type StartJobInput,
  type StartJobResult,
  type StudioInviteResult,
  type StudioJobResult,
  type StudioListingDetail,
  type StudioOverview,
  type StudioProjectDetail,
  type StudioProjectFacts,
  type StudioResaleFacts,
  type StudioResumeResult,
  type StudioUploadTarget,
  type StudioWarningSummary,
} from "../studio-types";
import {
  StudioAccessError,
  type StudioActor,
  type StudioAuditEntry,
  type StudioDeps,
  type StudioJobRow,
  type StudioListingPublishRow,
  type StudioPrivateContact,
} from "./contracts";
import { logStudioFailure, safeMessageFor, StudioError, toSafeError } from "./errors";
import {
  attemptPrefixFromToken,
  declareJobFiles,
  gatherMaterials,
  MAX_UPLOAD_BYTES,
  PUBLIC_DOCUMENT_BUCKET,
  PUBLIC_IMAGE_BUCKET,
  publicJobPrefix,
  type GatheredMaterials,
} from "./extraction";
import { assertNotPartnerDemo, assertOwner } from "./membership";

export const MAX_JOB_FILES = 60;
export { MAX_UPLOAD_BYTES };
/** A processing claim older than this is considered abandoned and resumable. */
export const STALE_PROCESSING_SECONDS = 900; // 15 minutes
/**
 * A live worker refreshes its lease at most this often (between files and
 * archive entries), so legitimate long processing never looks abandoned while
 * a genuinely dead worker still goes stale within STALE_PROCESSING_SECONDS.
 */
export const HEARTBEAT_SECONDS = 60;
/** Jobs auto-resumed per dashboard poll / cron tick. */
export const RESUME_BATCH = 5;
/** Public buckets Studio media can be copied into (cleanup sweeps both). */
const PUBLIC_MEDIA_BUCKETS = [PUBLIC_IMAGE_BUCKET, PUBLIC_DOCUMENT_BUCKET];
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TEXT_LIMIT = 4000;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function actorProvenanceStatus(actor: StudioActor): ProvenanceStatus {
  // Direct publication authorization is NOT verification: an ordinary Studio
  // entry is *_provided, never owner_verified.
  return actor.role === "owner" ? "owner_provided" : "trusted_publisher_provided";
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, TEXT_LIMIT);
  return trimmed || undefined;
}

function cleanNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value.replace(/,/g, "")) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function warningSummaries(warnings: ProgressiveWarning[]): StudioWarningSummary[] {
  return warnings.map((warning) => ({ code: warning.code, message: warning.message }));
}

function sealedBatch(body: Omit<ProgressiveBatch, "batch_fingerprint">): ProgressiveBatch {
  return { ...body, batch_fingerprint: fingerprintBatch(body) };
}

function publicationPatchBatch(
  slug: string,
  publish: boolean,
  actor: StudioActor,
  suppliedAt: string,
): ProgressiveBatch {
  return sealedBatch({
    schema_version: "1",
    mode: "enrich",
    project: {
      slug,
      publish,
      field_provenance: {
        public_status: { status: actorProvenanceStatus(actor), supplied_at: suppliedAt },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Manual facts → progressive fields (role-ranked provenance)
// ---------------------------------------------------------------------------

interface ManualProjectFields {
  fields: Record<string, unknown>;
  provenance: FieldProvenanceMap;
}

function manualProjectFields(
  raw: StudioProjectFacts | undefined,
  actor: StudioActor,
  suppliedAt: string,
): ManualProjectFields {
  const fields: Record<string, unknown> = {};
  const provenance: FieldProvenanceMap = {};
  if (!raw) return { fields, provenance };
  const status = actorProvenanceStatus(actor);
  const put = (column: string, value: unknown) => {
    if (value === undefined) return;
    fields[column] = value;
    provenance[column] = { status, supplied_at: suppliedAt, note: "studio_manual_entry" };
  };
  put("name", cleanText(raw.name));
  put("developer_name_raw", cleanText(raw.developerName));
  put("location_name_raw", cleanText(raw.locationText));
  put("project_type", cleanText(raw.projectType));
  put("short_description", cleanText(raw.shortDescription));
  put("full_description", cleanText(raw.fullDescription));
  put("construction_status", cleanText(raw.constructionStatus));
  put("ownership_type", cleanText(raw.ownershipType));
  put("completion_date", cleanText(raw.completionDate));
  put("starting_price_thb", cleanNumber(raw.startingPriceThb));
  put("price_range", cleanText(raw.priceRange));
  put("address", cleanText(raw.address));
  return { fields, provenance };
}

// ---------------------------------------------------------------------------
// Job creation: declare private staging, hand out signed upload targets
// ---------------------------------------------------------------------------

export async function startUploadJob(
  deps: StudioDeps,
  actor: StudioActor,
  input: StartJobInput,
): Promise<StartJobResult> {
  assertNotPartnerDemo(deps);
  if (!STUDIO_WORKFLOWS.includes(input.workflow)) {
    throw new StudioAccessError("workflow_invalid");
  }
  const files = input.files ?? [];
  if (files.length > MAX_JOB_FILES) {
    throw new StudioAccessError("too_many_files", `At most ${MAX_JOB_FILES} files per upload.`);
  }
  for (const file of files) {
    if (!cleanText(file.name)) throw new StudioAccessError("file_name_required");
    if (typeof file.size === "number" && file.size > MAX_UPLOAD_BYTES) {
      throw new StudioAccessError("file_too_large", `${file.name} exceeds the 1 GB limit.`);
    }
  }
  const projectSlug = cleanText(input.projectSlug);
  if (projectSlug && !SLUG_PATTERN.test(projectSlug)) {
    throw new StudioAccessError("project_slug_invalid");
  }

  // The job id is server-generated by the database default; create then read
  // its id back so every staging path is job-scoped.
  const declaredFilesInput = files.map((file) => ({
    name: file.name,
    size: file.size,
    contentType: file.contentType,
  }));
  const jobId = crypto.randomUUID();
  const declared = declareJobFiles(jobId, declaredFilesInput);
  const job: StudioJobRow = {
    id: jobId,
    created_by: actor.userId,
    creator_email: actor.email,
    creator_role: actor.role,
    workflow: input.workflow,
    project_slug: projectSlug ?? null,
    listing_id: null,
    status: "received",
    processing_token: null,
    content_fingerprint: null,
    facts: {
      ...(input.projectFacts ? { projectFacts: input.projectFacts } : {}),
      ...(input.resaleFacts ? { resaleFacts: input.resaleFacts } : {}),
    },
    files: declared,
    result_summary: null,
    error_code: null,
    error: null,
    retryable: true,
    attempt_count: 0,
    created_at: deps.now(),
  };
  await deps.data.createJob(job);

  const uploads: StudioUploadTarget[] = [];
  for (const file of declared) {
    const { token } = await deps.storage.createSignedUpload(file.stagingBucket, file.stagingPath);
    uploads.push({ name: file.name, bucket: file.stagingBucket, path: file.stagingPath, token });
  }
  await recordAuditSafely(deps, {
    actor_id: actor.userId,
    actor_email: actor.email,
    action: "studio_job_created",
    table_name: "studio_upload_jobs",
    record_id: jobId,
    metadata: {
      workflow: input.workflow,
      files: declared.length,
      project_slug: projectSlug ?? null,
    },
  });
  return { jobId, uploads };
}

// ---------------------------------------------------------------------------
// Job processing: claim → gather → atomic publish → finalize
// ---------------------------------------------------------------------------

function jobResultFromRow(job: StudioJobRow): StudioJobResult {
  const stored = (job.result_summary ?? {}) as Partial<StudioJobResult>;
  return {
    jobId: job.id,
    status: job.status,
    workflow: job.workflow,
    pagePath: stored.pagePath ?? null,
    projectSlug: stored.projectSlug ?? job.project_slug,
    listingId: stored.listingId ?? job.listing_id,
    publicStatus: stored.publicStatus ?? null,
    counts: stored.counts ?? null,
    warnings: stored.warnings ?? [],
    errorCode: job.error_code,
    error: job.error,
    retryable: job.retryable,
  };
}

export async function processUploadJob(
  deps: StudioDeps,
  actor: StudioActor,
  jobId: string,
): Promise<StudioJobResult> {
  assertNotPartnerDemo(deps);
  const job = await deps.data.getJob(jobId);
  if (!job) throw new StudioAccessError("job_not_found");
  if (job.created_by !== actor.userId && actor.role !== "owner") {
    throw new StudioAccessError("job_forbidden");
  }
  return claimAndProcess(deps, actor, job);
}

/**
 * Automatic durable resume. Called on every dashboard poll (and safe for a
 * scheduled worker/cron to call) to pick up received, retryable-failed, or
 * stale-processing jobs and drive them to completion — no second publication
 * decision, no lost work when the phone browser closes.
 */
export async function resumeDueJobs(
  deps: StudioDeps,
  actor: StudioActor,
): Promise<StudioResumeResult> {
  if (deps.partnerDemoActive()) return { resumed: 0, results: [] };
  const due = await deps.data.listDueJobs(STALE_PROCESSING_SECONDS, RESUME_BATCH);
  const mine = due.filter((job) => actor.role === "owner" || job.created_by === actor.userId);
  const results: StudioJobResult[] = [];
  for (const job of mine) {
    results.push(await claimAndProcess(deps, actor, job));
  }
  return { resumed: results.filter((r) => r.status === "published").length, results };
}

async function claimAndProcess(
  deps: StudioDeps,
  actor: StudioActor,
  jobRow: StudioJobRow,
): Promise<StudioJobResult> {
  // Re-entry after success is a read, not a re-publication.
  if (jobRow.status === "published" && jobRow.result_summary) {
    return jobResultFromRow(jobRow);
  }

  const token = deps.newToken();
  const claimed = await deps.data.claimJob(jobRow.id, token, STALE_PROCESSING_SECONDS);
  if (!claimed) {
    // Already published, terminally failed, or freshly held by another worker.
    const current = await deps.data.getJob(jobRow.id);
    if (!current) throw new StudioAccessError("job_not_found");
    return jobResultFromRow(current);
  }
  return processClaimedJob(deps, actor, claimed, token);
}

/** Non-fatal post-commit audit: never invalidates a committed write. */
async function recordAuditSafely(deps: StudioDeps, entry: StudioAuditEntry): Promise<void> {
  try {
    await deps.data.recordAudit(entry);
  } catch (error) {
    logStudioFailure(`audit_write_failed:${entry.action}`, error);
  }
}

/** Remove objects grouped by their OWN bucket (never one bucket for all). */
async function removeGroupedByBucket(
  deps: StudioDeps,
  objects: Array<{ bucket: string; path: string }>,
): Promise<void> {
  const byBucket = new Map<string, string[]>();
  for (const object of objects) {
    const paths = byBucket.get(object.bucket) ?? [];
    paths.push(object.path);
    byBucket.set(object.bucket, paths);
  }
  for (const [bucket, paths] of byBucket) {
    await deps.storage.remove(bucket, paths).catch(() => undefined);
  }
}

/**
 * Post-commit hygiene by the winning attempt: remove every other attempt's
 * token-scoped public objects for this job (orphans of stale, failed, or
 * crashed attempts). The winner's own prefix is never touched; failures here
 * are logged and never affect the committed publication.
 */
async function cleanupForeignAttemptObjects(
  deps: StudioDeps,
  jobId: string,
  token: string,
): Promise<void> {
  const mine = attemptPrefixFromToken(token);
  const prefix = publicJobPrefix(jobId);
  for (const bucket of PUBLIC_MEDIA_BUCKETS) {
    try {
      const children = await deps.storage.listNames(bucket, prefix);
      for (const child of children) {
        if (child === mine) continue;
        const inner = await deps.storage.listNames(bucket, `${prefix}/${child}`);
        const paths = inner.size
          ? [...inner].map((name) => `${prefix}/${child}/${name}`)
          : [`${prefix}/${child}`];
        await deps.storage.remove(bucket, paths);
      }
    } catch (error) {
      logStudioFailure("orphan_cleanup_deferred", error);
    }
  }
}

/**
 * Throttled lease heartbeat. A worker that lost its claim must stop
 * immediately: it can no longer finalize, and its token-scoped side effects
 * are cleaned up by its own failure path or by the winner.
 */
function makeHeartbeat(deps: StudioDeps, jobId: string, token: string): () => Promise<void> {
  let last = Date.parse(deps.now());
  return async () => {
    const now = Date.parse(deps.now());
    if (now - last < HEARTBEAT_SECONDS * 1000) return;
    last = now;
    const alive = await deps.data.heartbeatJob(jobId, token);
    if (!alive) {
      throw new StudioError(
        "studio_job_not_claimed",
        safeMessageFor("studio_job_not_claimed"),
        true,
      );
    }
  };
}

/**
 * Drive one CLAIMED processing attempt to completion. Exported for the
 * concurrency regression tests, which use it to model a stale worker
 * continuing after a newer claim has taken over.
 */
export async function processClaimedJob(
  deps: StudioDeps,
  actor: StudioActor,
  claimed: StudioJobRow,
  token: string,
): Promise<StudioJobResult> {
  let materials: GatheredMaterials | undefined;
  // Set the moment the atomic publication transaction commits. From then on
  // this attempt's public objects belong to the published page and must
  // never be removed, and the job must never be reported as failed.
  const commitState = { committed: false };
  try {
    materials = await gatherMaterials(deps, claimed, {
      token,
      heartbeat: makeHeartbeat(deps, claimed.id, token),
    });
    // Persist the observed file records (size, sha256, media class, status).
    // Claim-checked: a stale worker must not overwrite a newer claim's data.
    const stillClaimed = await deps.data.updateJobIfClaimed(claimed.id, token, {
      files: materials.files,
    });
    if (!stillClaimed) {
      throw new StudioError(
        "studio_job_not_claimed",
        safeMessageFor("studio_job_not_claimed"),
        true,
      );
    }
    const result =
      claimed.workflow === "resale_listing"
        ? await finalizeResale(deps, actor, claimed, materials, token, commitState)
        : await finalizeProject(deps, actor, claimed, materials, token, commitState);
    return result;
  } catch (error) {
    const safe = toSafeError(error, mapFailureCode(error));

    if (commitState.committed) {
      // The publication committed; a later error (audit, hygiene) must never
      // fail the result or remove the published page's media.
      logStudioFailure("post_commit_error_ignored", error);
      try {
        const current = await deps.data.getJob(claimed.id);
        if (current) return jobResultFromRow(current);
      } catch (readError) {
        logStudioFailure("post_commit_read_failed", readError);
      }
      return {
        ...jobResultFromRow(claimed),
        status: "published",
        warnings: materials ? warningSummaries(materials.warnings) : [],
      };
    }

    // Not committed by us (as far as we observed). Re-read the job before
    // touching storage: if it is published, only delete our copies when the
    // recorded winning attempt is provably a DIFFERENT attempt — if our own
    // publish committed but its response was lost, our objects ARE the page's
    // media and must be kept. If the job state cannot be read, retain our
    // objects (deterministic retention: the winner's post-commit sweep
    // removes foreign prefixes) rather than risk deleting committed media.
    let currentState: StudioJobRow | null | undefined;
    try {
      currentState = await deps.data.getJob(claimed.id);
    } catch {
      currentState = undefined;
    }
    if (currentState?.status === "published") {
      const winner = (currentState.result_summary as { attempt?: string } | null)?.attempt;
      if (winner && winner !== attemptPrefixFromToken(token) && materials?.publicObjects.length) {
        await removeGroupedByBucket(deps, materials.publicObjects);
      }
      return jobResultFromRow(currentState);
    }
    if (currentState !== undefined && materials?.publicObjects.length) {
      await removeGroupedByBucket(deps, materials.publicObjects);
    }

    await deps.data
      .failJob({
        jobId: claimed.id,
        token,
        errorCode: safe.code,
        message: safe.message,
        retryable: safe.retryable,
      })
      .catch(() => undefined);
    return {
      jobId: claimed.id,
      status: "failed",
      workflow: claimed.workflow,
      pagePath: null,
      projectSlug: claimed.project_slug,
      listingId: claimed.listing_id,
      publicStatus: null,
      counts: null,
      warnings: materials ? warningSummaries(materials.warnings) : [],
      errorCode: safe.code,
      error: safe.message,
      retryable: safe.retryable,
    };
  }
}

function mapFailureCode(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("forever_progressive_ingest") || text.includes("studio_publish"))
    return "ingest_failed";
  if (text.toLowerCase().includes("storage")) return "storage_unavailable";
  return "processing_failed";
}

/** Stable identity for a project upload — never blocks on missing business data. */
function deriveProjectSlug(
  job: StudioJobRow,
  manualName: string | undefined,
  derivedName: string | null,
): string {
  if (job.project_slug) return job.project_slug;
  const fromName = manualName ? slugify(manualName) : derivedName ? slugify(derivedName) : "";
  if (fromName) return fromName;
  // Deterministic fallback so a retry converges on the same page.
  return `new-project-${job.created_at.slice(0, 10)}-${job.id.slice(0, 8)}`;
}

async function finalizeProject(
  deps: StudioDeps,
  actor: StudioActor,
  job: StudioJobRow,
  materials: GatheredMaterials,
  token: string,
  commitState: { committed: boolean },
): Promise<StudioJobResult> {
  const suppliedAt = job.created_at;
  const manual = manualProjectFields(
    job.facts.projectFacts as StudioProjectFacts | undefined,
    actor,
    suppliedAt,
  );
  const extracted = materials.factFields;

  const fields: Record<string, unknown> = { ...(extracted?.fields ?? {}), ...manual.fields };
  const provenance: FieldProvenanceMap = { ...(extracted?.provenance ?? {}), ...manual.provenance };

  const manualName = typeof manual.fields.name === "string" ? manual.fields.name : undefined;
  const slug = deriveProjectSlug(job, manualName, materials.derivedName);
  const existing = await deps.data.findProjectBySlug(slug);
  const mode: "create" | "enrich" = existing ? "enrich" : "create";
  const extraWarnings: ProgressiveWarning[] = [...materials.warnings];

  if (mode === "enrich" && job.workflow === "new_development") {
    extraWarnings.push({
      entity: "project",
      code: "project_exists_updated",
      severity: "info",
      message: `Project "${slug}" already exists; the upload was applied as an update, not a duplicate.`,
    });
  }
  if (mode === "create" && job.workflow !== "new_development") {
    extraWarnings.push({
      entity: "project",
      code: "project_missing_created",
      severity: "warning",
      message: `No project "${slug}" existed yet; it was created from this upload.`,
    });
  }

  // A create needs a display name (technical envelope, not a business gate).
  if (mode === "create" && typeof fields.name !== "string") {
    const display = materials.derivedName ?? titleFromSlug(slug);
    fields.name = display;
    provenance.name = { status: "inferred", note: "derived_identity", supplied_at: suppliedAt };
    extraWarnings.push({
      entity: "project",
      field: "name",
      code: "project_name_derived",
      severity: "info",
      message: `No project name was provided; "${display}" was used for now — rename it any time.`,
    });
  }

  const existingState = mode === "enrich" ? await deps.fetchExisting(slug) : undefined;
  const existingValues = existingState?.project?.values ?? {};

  // Blank-filling only: an uploaded photo/brochure never replaces an existing
  // cover image or brochure link.
  if (materials.firstPhotoUrl && fields.main_image_url === undefined) {
    if (mode === "create" || existingValues.main_image_url == null) {
      fields.main_image_url = materials.firstPhotoUrl;
      provenance.main_image_url = { status: "extracted", note: "first_uploaded_photo" };
    }
  }
  if (materials.firstBrochureUrl && fields.brochure_url === undefined) {
    if (mode === "create" || existingValues.brochure_url == null) {
      fields.brochure_url = materials.firstBrochureUrl;
      provenance.brochure_url = { status: "extracted", note: "first_uploaded_brochure" };
    }
  }

  const project: ProgressiveProjectPayload =
    mode === "create"
      ? ({ slug, ...fields, field_provenance: provenance } as ProgressiveProjectPayload)
      : { slug, set: fields, field_provenance: provenance };

  const batch = await buildProgressiveBatch(deps.reader, {
    mode,
    project,
    priceList: materials.priceList,
    countryEvidence: extracted?.countryEvidence,
    media: materials.media,
    existing: existingState,
    extraWarnings,
  });

  const resultPayload = {
    pagePath: projectPagePath(slug),
    projectSlug: slug,
    warnings: warningSummaries(batch.warnings ?? []),
    workflow: job.workflow,
    // Which attempt's token-scoped storage objects the publication uses —
    // lets every cleanup path tell the winner's objects from orphans.
    attempt: attemptPrefixFromToken(token),
  };

  // ONE atomic transaction: ingest graph + publish + finalize job.
  const summary = await deps.data.publishProject({
    jobId: job.id,
    token,
    batch,
    publish: true,
    result: resultPayload,
  });
  commitState.committed = true;

  if (summary.replayed) {
    // Another attempt already published this job; our token-scoped copies
    // are orphans (the page references the winner's paths). Remove only ours.
    await removeGroupedByBucket(deps, materials.publicObjects);
  } else {
    // We won: sweep other attempts' orphaned public objects, then audit.
    // Both are post-commit hygiene — non-destructive to the publication and
    // non-fatal on failure.
    await cleanupForeignAttemptObjects(deps, job.id, token);
    await recordAuditSafely(deps, {
      actor_id: actor.userId,
      actor_email: actor.email,
      action: mode === "create" ? "studio_project_created_published" : "studio_project_updated",
      table_name: "projects",
      record_id: summary.project_id,
      metadata: { job_id: job.id, workflow: job.workflow, mode, counts: summary.counts },
    });
  }

  return {
    jobId: job.id,
    status: "published",
    workflow: job.workflow,
    pagePath: resultPayload.pagePath,
    projectSlug: slug,
    listingId: null,
    publicStatus: summary.public_status,
    counts: summary.counts,
    warnings: resultPayload.warnings,
    errorCode: null,
    error: null,
    retryable: true,
  };
}

// ---------------------------------------------------------------------------
// Resale listings: publish without a complete project record; private contact
// ---------------------------------------------------------------------------

function manualListingProvenance(
  facts: StudioResaleFacts,
  actor: StudioActor,
  suppliedAt: string,
): FieldProvenanceMap {
  const status = actorProvenanceStatus(actor);
  const provenance: FieldProvenanceMap = {};
  for (const [key, value] of Object.entries(facts)) {
    if (key === "contactName" || key === "contactPhone" || key === "contactEmail") continue;
    if (value === undefined || value === null || value === "") continue;
    provenance[key] = { status, supplied_at: suppliedAt, note: "studio_manual_entry" };
  }
  return provenance;
}

async function finalizeResale(
  deps: StudioDeps,
  actor: StudioActor,
  job: StudioJobRow,
  materials: GatheredMaterials,
  token: string,
  commitState: { committed: boolean },
): Promise<StudioJobResult> {
  const suppliedAt = job.created_at;
  const facts = (job.facts.resaleFacts ?? {}) as StudioResaleFacts;
  const warnings: ProgressiveWarning[] = [...materials.warnings];

  let title = cleanText(facts.title);
  if (!title) {
    const projectName = cleanText(facts.projectName);
    const bedrooms = cleanNumber(facts.bedrooms);
    title = projectName
      ? `${projectName} — resale`
      : bedrooms
        ? `${bedrooms}-bedroom resale`
        : `Resale listing ${suppliedAt.slice(0, 10)}`;
    warnings.push({
      entity: "listing",
      field: "title",
      code: "listing_title_derived",
      severity: "info",
      message: `No title was provided; "${title}" was used — rename it any time.`,
    });
  }

  let currency = cleanText(facts.currency)?.toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    warnings.push({
      entity: "listing",
      field: "currency",
      code: "currency_invalid_ignored",
      severity: "warning",
      message: `"${currency}" is not a 3-letter currency code; the price was stored without a currency.`,
    });
    currency = undefined;
  }

  // buildListingDraft resolves the project/location without any contact input.
  const draft = await buildListingDraft(
    {
      reader: deps.reader,
      projects: {
        findProjectBySlug: async (slug) => {
          const project = await deps.data.findProjectBySlug(slug);
          return project ? { id: project.id } : null;
        },
      },
    },
    {
      title,
      projectNameRaw: cleanText(facts.projectName),
      locationNameRaw: cleanText(facts.locationText),
      propertyType: cleanText(facts.propertyType),
      bedrooms: cleanNumber(facts.bedrooms),
      bathrooms: cleanNumber(facts.bathrooms),
      areaSqm: cleanNumber(facts.areaSqm),
      price: cleanNumber(facts.price),
      currency,
      description: cleanText(facts.description),
      photos: materials.photoUrls,
      fieldProvenance: manualListingProvenance(facts, actor, suppliedAt),
    },
  );
  warnings.push(...draft.warnings);

  const slug = `${slugify(title).slice(0, 60) || "resale"}-${job.id.slice(0, 8)}`;
  const listingRow: StudioListingPublishRow = {
    title: draft.row.title,
    slug,
    project_id: draft.row.project_id,
    project_name_raw: draft.row.project_name_raw,
    location_id: draft.row.location_id,
    location_name_raw: draft.row.location_name_raw,
    property_type: draft.row.property_type,
    bedrooms: draft.row.bedrooms,
    bathrooms: draft.row.bathrooms,
    area_sqm: draft.row.area_sqm,
    price: draft.row.price,
    currency: draft.row.currency,
    availability_status: draft.row.availability_status,
    description: draft.row.description,
    photos: draft.row.photos,
    field_provenance: draft.row.field_provenance,
  };
  const contact: StudioPrivateContact = {
    contact_name: cleanText(facts.contactName) ?? null,
    contact_phone: cleanText(facts.contactPhone) ?? null,
    contact_email: cleanText(facts.contactEmail) ?? null,
  };

  const resultPayload = {
    pagePath: resalePagePath(slug),
    warnings: warningSummaries(warnings),
    workflow: job.workflow,
    attempt: attemptPrefixFromToken(token),
  };

  // ONE atomic transaction: listing upsert + private contact + warnings + job.
  const published = await deps.data.publishResale({
    jobId: job.id,
    token,
    listing: listingRow,
    contact,
    warnings,
    result: resultPayload,
  });
  commitState.committed = true;

  if (published.replayed) {
    await removeGroupedByBucket(deps, materials.publicObjects);
  } else {
    await cleanupForeignAttemptObjects(deps, job.id, token);
    await recordAuditSafely(deps, {
      actor_id: actor.userId,
      actor_email: actor.email,
      action: "studio_resale_published",
      table_name: "listings",
      record_id: published.listingId,
      metadata: { job_id: job.id, photos: materials.photoUrls.length },
    });
  }

  return {
    jobId: job.id,
    status: "published",
    workflow: job.workflow,
    pagePath: resalePagePath(published.slug),
    projectSlug: null,
    listingId: published.listingId,
    publicStatus: "published",
    counts: {
      buildings: 0,
      units: 0,
      prices: 0,
      media: materials.photoUrls.length,
      warnings: warnings.length,
    },
    warnings: resultPayload.warnings,
    errorCode: null,
    error: null,
    retryable: true,
  };
}

// ---------------------------------------------------------------------------
// Direct actions: publish / unpublish / edit / hero
// ---------------------------------------------------------------------------

export async function setProjectPublication(
  deps: StudioDeps,
  actor: StudioActor,
  input: { slug: string; publish: boolean },
): Promise<{ slug: string; publicStatus: string }> {
  assertNotPartnerDemo(deps);
  const project = await deps.data.findProjectBySlug(input.slug);
  if (!project) throw new StudioAccessError("project_not_found");
  const summary = await deps.ingest.ingest(
    publicationPatchBatch(input.slug, input.publish, actor, deps.now()),
  );
  await recordAuditSafely(deps, {
    actor_id: actor.userId,
    actor_email: actor.email,
    action: input.publish ? "studio_project_published" : "studio_project_unpublished",
    table_name: "projects",
    record_id: project.id,
    metadata: { slug: input.slug },
  });
  return { slug: input.slug, publicStatus: summary.public_status };
}

export async function saveProjectFacts(
  deps: StudioDeps,
  actor: StudioActor,
  input: { slug: string; facts: StudioProjectFacts },
): Promise<{ slug: string; warnings: StudioWarningSummary[] }> {
  assertNotPartnerDemo(deps);
  const project = await deps.data.findProjectBySlug(input.slug);
  if (!project) throw new StudioAccessError("project_not_found");
  const manual = manualProjectFields(input.facts, actor, deps.now());
  if (Object.keys(manual.fields).length === 0) {
    return { slug: input.slug, warnings: [] };
  }
  const existingState = await deps.fetchExisting(input.slug);
  const batch = await buildProgressiveBatch(deps.reader, {
    mode: "enrich",
    project: { slug: input.slug, set: manual.fields, field_provenance: manual.provenance },
    existing: existingState,
  });
  await deps.ingest.ingest(batch);
  await recordAuditSafely(deps, {
    actor_id: actor.userId,
    actor_email: actor.email,
    action: "studio_project_facts_saved",
    table_name: "projects",
    record_id: project.id,
    metadata: { slug: input.slug, fields: Object.keys(manual.fields) },
  });
  return { slug: input.slug, warnings: warningSummaries(batch.warnings ?? []) };
}

export async function setProjectHeroImage(
  deps: StudioDeps,
  actor: StudioActor,
  input: { slug: string; url: string },
): Promise<{ slug: string }> {
  assertNotPartnerDemo(deps);
  const detail = await deps.data.getProjectDetail(input.slug);
  if (!detail) throw new StudioAccessError("project_not_found");
  // The chosen hero must be an existing media URL of THIS project — never an
  // arbitrary caller-supplied URL.
  const known = detail.media.some((item) => item.url === input.url) || input.url === "";
  if (!known)
    throw new StudioAccessError("hero_image_unknown", "Choose one of this project's images.");
  const suppliedAt = deps.now();
  const batch = await buildProgressiveBatch(deps.reader, {
    mode: "enrich",
    project: {
      slug: input.slug,
      set: { main_image_url: input.url || null },
      // Owner-provided: a deliberate hero choice outranks the auto-picked one.
      field_provenance: {
        main_image_url: { status: actorProvenanceStatus(actor), supplied_at: suppliedAt },
      },
    },
    existing: await deps.fetchExisting(input.slug),
  });
  await deps.ingest.ingest(batch);
  await recordAuditSafely(deps, {
    actor_id: actor.userId,
    actor_email: actor.email,
    action: "studio_project_hero_set",
    table_name: "projects",
    record_id: detail.project.id,
    metadata: { slug: input.slug },
  });
  return { slug: input.slug };
}

export async function setListingPublication(
  deps: StudioDeps,
  actor: StudioActor,
  input: { listingId: string; publish: boolean },
): Promise<{ listingId: string; publicationStatus: string }> {
  assertNotPartnerDemo(deps);
  const listing = await deps.data.getListing(input.listingId);
  if (!listing) throw new StudioAccessError("listing_not_found");
  const publicationStatus = input.publish ? "published" : "draft";
  await deps.data.updateListing(input.listingId, { publication_status: publicationStatus });
  await recordAuditSafely(deps, {
    actor_id: actor.userId,
    actor_email: actor.email,
    action: input.publish ? "studio_listing_published" : "studio_listing_unpublished",
    table_name: "listings",
    record_id: input.listingId,
    metadata: {},
  });
  return { listingId: input.listingId, publicationStatus };
}

/** Resale fact key → public listing column (provenance keys use fact keys). */
const RESALE_FIELD_COLUMNS: ReadonlyArray<{
  factKey: keyof StudioResaleFacts;
  column: string;
  kind: "text" | "number";
}> = [
  { factKey: "title", column: "title", kind: "text" },
  { factKey: "projectName", column: "project_name_raw", kind: "text" },
  { factKey: "locationText", column: "location_name_raw", kind: "text" },
  { factKey: "propertyType", column: "property_type", kind: "text" },
  { factKey: "bedrooms", column: "bedrooms", kind: "number" },
  { factKey: "bathrooms", column: "bathrooms", kind: "number" },
  { factKey: "areaSqm", column: "area_sqm", kind: "number" },
  { factKey: "price", column: "price", kind: "number" },
  { factKey: "currency", column: "currency", kind: "text" },
  { factKey: "description", column: "description", kind: "text" },
];

/**
 * Edit a resale listing under the SAME provenance precedence as project
 * enrichment: a Trusted Publisher fills blanks and may update an equal-or-
 * weaker-ranked value, but never silently replaces an Owner-provided (or
 * stronger) value — the stronger value is preserved and a truthful conflict
 * record is persisted for later Owner editing. No approval gate is created.
 */
export async function updateResaleListing(
  deps: StudioDeps,
  actor: StudioActor,
  input: { listingId: string; facts: StudioResaleFacts },
): Promise<{ listingId: string; warnings: StudioWarningSummary[] }> {
  assertNotPartnerDemo(deps);
  const listing = await deps.data.getListingDetail(input.listingId);
  if (!listing) throw new StudioAccessError("listing_not_found");
  const suppliedAt = deps.now();
  const existingProvenance =
    (listing as unknown as { field_provenance?: FieldProvenanceMap }).field_provenance ?? {};
  const incomingStatus = actorProvenanceStatus(actor);
  const patch: Record<string, unknown> = {};
  const appliedProvenance: FieldProvenanceMap = {};
  const conflicts: ProgressiveWarning[] = [];

  for (const { factKey, column, kind } of RESALE_FIELD_COLUMNS) {
    const raw = input.facts[factKey];
    let value: unknown = kind === "number" ? cleanNumber(raw) : cleanText(raw);
    if (factKey === "currency" && typeof value === "string") {
      const upper = value.toUpperCase();
      if (!/^[A-Z]{3}$/.test(upper)) continue;
      value = upper;
    }
    if (value === undefined) continue;

    const currentValue = (listing as Record<string, unknown>)[column];
    const currentIsNull = currentValue == null || currentValue === "";
    const incoming: FieldProvenance = {
      status: incomingStatus,
      supplied_at: suppliedAt,
      note: "studio_manual_entry",
    };
    const verdict = canReplaceField(existingProvenance[factKey], incoming, currentIsNull);
    if (verdict === "apply") {
      patch[column] = value;
      appliedProvenance[factKey] = incoming;
    } else {
      conflicts.push({
        entity: "listing",
        field: column,
        code: "listing_field_conflict_preserved",
        severity: "warning",
        message: `${column}: the current value was set by a stronger source (${existingProvenance[factKey]?.status ?? "unknown"}) and was preserved; the attempted change by ${actor.role} was recorded, not applied.`,
        payload: { attempted_by: actor.role, attempted_status: incomingStatus },
      });
    }
  }

  // Private contact — routed to the private table, never to the public row.
  // Contact data is operational, not provenance-ranked: always editable.
  const contactTouched =
    input.facts.contactName !== undefined ||
    input.facts.contactPhone !== undefined ||
    input.facts.contactEmail !== undefined;
  if (contactTouched) {
    await deps.data.setListingContact(input.listingId, {
      contact_name: cleanText(input.facts.contactName) ?? listing.contact.contact_name,
      contact_phone: cleanText(input.facts.contactPhone) ?? listing.contact.contact_phone,
      contact_email: cleanText(input.facts.contactEmail) ?? listing.contact.contact_email,
    });
  }

  if (Object.keys(patch).length > 0) {
    patch.field_provenance = { ...existingProvenance, ...appliedProvenance };
    await deps.data.updateListing(input.listingId, patch);
  }
  if (conflicts.length > 0) {
    // Truthful, persistent conflict records — visible in Studio, never a gate.
    await deps.data.addListingWarnings(input.listingId, conflicts);
  }
  await recordAuditSafely(deps, {
    actor_id: actor.userId,
    actor_email: actor.email,
    action: "studio_listing_updated",
    table_name: "listings",
    record_id: input.listingId,
    metadata: {
      fields: Object.keys(patch),
      contact: contactTouched,
      conflicts: conflicts.map((warning) => warning.field),
    },
  });
  return { listingId: input.listingId, warnings: warningSummaries(conflicts) };
}

// ---------------------------------------------------------------------------
// Dashboard + detail (prefill) + membership
// ---------------------------------------------------------------------------

export async function getProjectDetail(
  deps: StudioDeps,
  _actor: StudioActor,
  slug: string,
): Promise<StudioProjectDetail | null> {
  const detail = await deps.data.getProjectDetail(slug);
  if (!detail) return null;
  const row = detail.project;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const provenance =
    (row.field_provenance as Record<string, { source_date?: string }> | undefined) ?? {};
  const sourceDates = Object.values(provenance)
    .map((p) => p?.source_date)
    .filter((d): d is string => typeof d === "string")
    .sort();
  return {
    slug: row.slug,
    name: row.name,
    publicStatus: row.public_status,
    isActive: row.is_active,
    isPublic: row.is_active && row.public_status === "published",
    facts: {
      name: str(row.name),
      developerName: str(row.developer_name_raw),
      locationText: str(row.location_name_raw) ?? str(row.location_area),
      projectType: str(row.project_type),
      shortDescription: str(row.short_description),
      fullDescription: str(row.full_description),
      constructionStatus: str(row.construction_status),
      ownershipType: str(row.ownership_type),
      completionDate: str(row.completion_date),
      startingPriceThb: num(row.starting_price_thb),
      priceRange: str(row.price_range),
      address: str(row.address),
    },
    mainImageUrl: row.main_image_url,
    media: detail.media.map((m) => ({
      url: m.url,
      mediaType: m.media_type,
      title: m.title,
      sortOrder: m.sort_order,
      isHero: m.url === row.main_image_url,
    })),
    updatedAt: row.updated_at,
    lastSourceDate: sourceDates.length ? sourceDates[sourceDates.length - 1] : null,
  };
}

export async function getListingDetail(
  deps: StudioDeps,
  _actor: StudioActor,
  listingId: string,
): Promise<StudioListingDetail | null> {
  const row = await deps.data.getListingDetail(listingId);
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    publicationStatus: row.publication_status,
    isPublic: row.publication_status === "published",
    facts: {
      title: row.title,
      projectName: (row.project_name_raw as string | null) ?? undefined,
      locationText: (row.location_name_raw as string | null) ?? undefined,
      propertyType: (row.property_type as string | null) ?? undefined,
      bedrooms: (row.bedrooms as number | null) ?? undefined,
      bathrooms: (row.bathrooms as number | null) ?? undefined,
      areaSqm: (row.area_sqm as number | null) ?? undefined,
      price: row.price ?? undefined,
      currency: row.currency ?? undefined,
      description: (row.description as string | null) ?? undefined,
      contactName: row.contact.contact_name ?? undefined,
      contactPhone: row.contact.contact_phone ?? undefined,
      contactEmail: row.contact.contact_email ?? undefined,
    },
    photos: row.photos,
    updatedAt: row.updated_at,
  };
}

export async function getOverview(deps: StudioDeps, actor: StudioActor): Promise<StudioOverview> {
  const [projects, listings, allJobs] = await Promise.all([
    deps.data.listProjects(),
    deps.data.listListings(),
    deps.data.listJobs(25),
  ]);
  const members = actor.role === "owner" ? await deps.data.listMembers() : [];
  // Operational-history isolation: the Owner sees every job; a Trusted
  // Publisher receives ONLY their own jobs (and therefore only their own
  // errors, creator email, and staging metadata). Enforced here at the data
  // response boundary — the UI never sees what it must not show.
  const jobs = allJobs.filter((job) => actor.role === "owner" || job.created_by === actor.userId);
  const activeJobs = jobs.filter(
    (job) =>
      job.status === "received" ||
      job.status === "processing" ||
      (job.status === "failed" && job.retryable),
  ).length;
  return {
    session: {
      userId: actor.userId,
      email: actor.email,
      role: actor.role,
      displayName: actor.displayName,
    },
    projects: projects.map((project) => ({
      id: project.id,
      slug: project.slug,
      name: project.name,
      publicStatus: project.public_status,
      isActive: project.is_active,
      mainImageUrl: project.main_image_url,
      updatedAt: project.updated_at,
    })),
    listings: listings.map((listing) => ({
      id: listing.id,
      slug: listing.slug,
      title: listing.title,
      publicationStatus: listing.publication_status,
      price: listing.price,
      currency: listing.currency,
      photos: listing.photos,
      updatedAt: listing.updated_at,
    })),
    jobs: jobs.map((job) => ({
      id: job.id,
      workflow: job.workflow,
      status: job.status,
      projectSlug: job.project_slug,
      listingId: job.listing_id,
      creatorEmail: job.creator_email,
      createdAt: job.created_at,
      errorCode: job.error_code,
      error: job.error,
      retryable: job.retryable,
    })),
    members: members.map((member) => ({
      userId: member.user_id,
      role: member.role,
      email: member.email,
      displayName: member.display_name,
      isActive: member.is_active,
    })),
    activeJobs,
  };
}

export async function inviteMember(
  deps: StudioDeps,
  actor: StudioActor,
  input: { email: string; password?: string; displayName?: string },
): Promise<StudioInviteResult> {
  assertNotPartnerDemo(deps);
  assertOwner(actor);
  const email = cleanText(input.email)?.toLowerCase();
  if (!email || !email.includes("@")) throw new StudioAccessError("invite_email_invalid");

  // Invite an existing Supabase Auth account that is not yet a member, or
  // create a new confirmed account. A password is only needed for a NEW
  // account; it is never displayed, logged, or persisted.
  let userId = await deps.authAdmin.findUserIdByEmail(email);
  let created = false;
  if (!userId) {
    const password = input.password ?? "";
    if (password.length < 10) {
      throw new StudioAccessError(
        "invite_password_required",
        "This email has no account yet — set a temporary password of at least 10 characters. It is never shown again.",
      );
    }
    userId = (await deps.authAdmin.createUser(email, password)).id;
    created = true;
  }
  await deps.data.upsertMembership({
    user_id: userId,
    role: "trusted_publisher",
    display_name: cleanText(input.displayName) ?? null,
    email,
    invited_by: actor.userId,
    is_active: true,
  });
  await recordAuditSafely(deps, {
    actor_id: actor.userId,
    actor_email: actor.email,
    action: "studio_member_invited",
    table_name: "studio_members",
    record_id: userId,
    // No password material ever recorded.
    metadata: { email, role: "trusted_publisher", created },
  });
  return { userId, created };
}

export async function setMemberActive(
  deps: StudioDeps,
  actor: StudioActor,
  input: { userId: string; isActive: boolean },
): Promise<void> {
  assertNotPartnerDemo(deps);
  assertOwner(actor);
  const member = (await deps.data.listMembers()).find((row) => row.user_id === input.userId);
  if (!member) throw new StudioAccessError("member_not_found");
  if (!input.isActive) {
    if (member.user_id === actor.userId) {
      throw new StudioAccessError("cannot_disable_self");
    }
    if (member.role === "owner" && (await deps.data.countActiveOwners()) <= 1) {
      throw new StudioAccessError("cannot_disable_last_owner");
    }
  }
  await deps.data.upsertMembership({ ...member, is_active: input.isActive });
  await recordAuditSafely(deps, {
    actor_id: actor.userId,
    actor_email: actor.email,
    action: input.isActive ? "studio_member_enabled" : "studio_member_disabled",
    table_name: "studio_members",
    record_id: input.userId,
    metadata: {},
  });
}

// StudioError is re-exported so callers can throw safe processing failures.
export { StudioError };
