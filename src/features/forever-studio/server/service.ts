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
 *   An upload by an authenticated Owner or Trusted Publisher is authorization
 *   to INGEST — never to publish. Incomplete business data still never creates
 *   a follow-on approval or publication gate on the ingestion itself: missing
 *   facts become warnings and absent fields; unreadable files are retained
 *   privately; failures leave a retryable job that resumes automatically. Every
 *   write is project-isolated, transactional, and idempotent under retry.
 *
 *   Publication is a SEPARATE, explicitly authorized action
 *   (`setProjectPublication`). See UNPUBLISHED INGESTION below.
 */

import type {
  ProgressiveBatch,
  ProgressiveProjectPayload,
  ProgressiveWarning,
} from "@/features/forever-ingestion/batch-types";
import { fingerprintBatch, buildProgressiveBatch } from "@/features/forever-ingestion/build-batch";
import { buildListingDraft } from "@/features/forever-ingestion/listings";
import {
  type FieldProvenanceMap,
  type ProvenanceStatus,
} from "@/features/forever-ingestion/provenance";
import { slugify } from "@/import/persistence-projection";

import {
  externalJobStatus,
  isStudioAmenityCategory,
  isStudioMaterialPurpose,
  projectPagePath,
  resalePagePath,
  STUDIO_MAX_AMENITY_SORT_ORDER,
  STUDIO_MAX_FEATURED_AMENITIES,
  STUDIO_WORKFLOWS,
  type StartJobInput,
  type StartJobResult,
  type StudioArchiveConfirmInput,
  type StudioArchiveConfirmResult,
  type StudioArchivePlanInput,
  type StudioArchivePlanResult,
  type StudioInviteResult,
  type StudioJobProgress,
  type StudioJobResult,
  type StudioListingDetail,
  type StudioOverview,
  type StudioProjectDetail,
  type StudioProjectFacts,
  type StudioResaleFacts,
  type StudioRole,
  type StudioResumeResult,
  type StudioUploadTarget,
  type StudioWarningSummary,
} from "../studio-types";
import {
  StudioAccessError,
  type StudioActor,
  type StudioAmenityCatalogueRow,
  type StudioAuditEntry,
  type StudioDeps,
  type StudioJobRow,
  type StudioListingPublishRow,
  type StudioPrivateContact,
  type StudioProjectAmenityRow,
} from "./contracts";
import { logStudioFailure, redact, safeMessageFor, StudioError, toSafeError } from "./errors";
import {
  assertNewDirectMaterialPurpose,
  attemptPrefixFromToken,
  declareNewDirectJobFiles,
  gatherMaterials,
  MAX_UPLOAD_BYTES,
  PUBLIC_DOCUMENT_BUCKET,
  PUBLIC_IMAGE_BUCKET,
  publicJobPrefix,
  type GatheredMaterials,
} from "./extraction";
import {
  buildJobProgress,
  composeArchiveMaterials,
  confirmArchiveUpload,
  planArchiveUpload,
  runArchiveSlice,
  type ComposedArchiveMaterials,
} from "./large-archive";
import {
  archiveUploadCapabilityFor,
  assertArchiveControlPlaneAvailable,
} from "./archive-capability.server";
import { assertNotPartnerDemo, assertOwner } from "./membership";
import {
  buildStageTelemetry,
  inStage,
  isStudioProcessingStage,
  JOB_PROCESSING_FACTS_KEY,
  stageOf,
  stageTelemetryLogLine,
  STUDIO_STAGE_FAILURE_CODES,
  type StudioStageTelemetry,
} from "./processing-stage";
import {
  automaticRetryBudgetExhausted,
  automaticRetryState,
  nextAutomaticFailureCount,
  retryableAfterFailure,
  retryFactsPatch,
  type StudioAttemptKind,
} from "./retry-policy";
import { jobStorageFacts, jobStorageProvider } from "./storage/job-provider";
import type { StudioStorageProvider } from "./storage/provider";

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
/** Public buckets Studio derivatives can be uploaded into (cleanup sweeps both). */
const PUBLIC_MEDIA_BUCKETS = [PUBLIC_IMAGE_BUCKET, PUBLIC_DOCUMENT_BUCKET];
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TEXT_LIMIT = 4000;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function jobErrorStage(job: Pick<StudioJobRow, "facts">): string | null {
  const processing = job.facts[JOB_PROCESSING_FACTS_KEY] as { stage?: unknown } | undefined;
  return isStudioProcessingStage(processing?.stage) ? processing.stage : null;
}

function roleProvenanceStatus(role: StudioRole): ProvenanceStatus {
  // Direct publication authorization is NOT verification: an ordinary Studio
  // entry is *_provided, never owner_verified.
  return role === "owner" ? "owner_provided" : "trusted_publisher_provided";
}

function actorProvenanceStatus(actor: StudioActor): ProvenanceStatus {
  return roleProvenanceStatus(actor.role);
}

interface StudioSourcePrincipal {
  userId: string;
  email: string | null;
  /** Immutable submission-time role; provenance and audit only. */
  role: StudioRole;
}

interface StudioJobPrincipals {
  /** Immutable job creator snapshot used only for provenance and attribution. */
  source: StudioSourcePrincipal;
  /** Current active source membership used for authorization. */
  authorization: StudioActor;
  /** Signed-in account/background context that executes this attempt. */
  execution: StudioActor;
  /**
   * How this attempt was initiated — a signed-in session call or the
   * scheduled background runner. Audit truthfulness only, never authorization.
   */
  executionVia?: "session" | "scheduled_runner";
}

async function resolveJobPrincipals(
  deps: StudioDeps,
  execution: StudioActor,
  job: StudioJobRow,
): Promise<StudioJobPrincipals> {
  if (!job.created_by) throw new StudioAccessError("studio_membership_required");
  const membership = await deps.data.getMembership(job.created_by);
  if (!membership?.is_active) throw new StudioAccessError("studio_membership_required");

  return {
    source: {
      userId: job.created_by,
      email: job.creator_email,
      role: job.creator_role,
    },
    authorization: {
      userId: membership.user_id,
      email: membership.email,
      role: membership.role,
      displayName: membership.display_name,
    },
    execution,
  };
}

function jobPrincipalAuditMetadata(
  principals: StudioJobPrincipals,
): Record<string, string | boolean | null> {
  return {
    source_creator_id: principals.source.userId,
    source_creator_email: principals.source.email,
    source_creator_role: principals.source.role,
    authorization_principal_id: principals.authorization.userId,
    authorization_principal_role: principals.authorization.role,
    executed_by_id: principals.execution.userId,
    executed_by_role: principals.execution.role,
    executed_via: principals.executionVia ?? "session",
    resumed_by_owner:
      principals.execution.role === "owner" &&
      principals.execution.userId !== principals.source.userId,
  };
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

/**
 * Object-level Studio authorization.  This deliberately runs against the
 * service-role read before any detail, media, contact, storage, ingest, or
 * mutation operation.  Legacy/unassigned records are Owner-only: a Trusted
 * Publisher must never acquire a record merely because it lacks attribution.
 */
function assertObjectAccess(actor: StudioActor, createdBy: string | null | undefined): void {
  if (actor.role === "owner") return;
  if (createdBy === actor.userId) return;
  // One stable denial for another publisher AND legacy/unassigned data: no
  // existence, title, contact, staging, or metadata is disclosed.
  throw new StudioAccessError("studio_access_denied");
}

async function requireProjectAccess(
  deps: StudioDeps,
  actor: StudioActor,
  slug: string,
): Promise<NonNullable<Awaited<ReturnType<StudioDeps["data"]["findProjectBySlug"]>>>> {
  const project = await deps.data.findProjectBySlug(slug);
  if (!project) throw new StudioAccessError("project_not_found");
  assertObjectAccess(actor, await deps.data.getObjectCreatedBy("project", project.id));
  return project;
}

async function requireListingAccess(
  deps: StudioDeps,
  actor: StudioActor,
  listingId: string,
): Promise<NonNullable<Awaited<ReturnType<StudioDeps["data"]["getListing"]>>>> {
  const listing = await deps.data.getListing(listingId);
  if (!listing) throw new StudioAccessError("listing_not_found");
  assertObjectAccess(actor, await deps.data.getObjectCreatedBy("listing", listing.id));
  return listing;
}

function knownProjectSlug(
  projectSlug: string | null | undefined,
  facts: StudioProjectFacts | undefined,
): string | null {
  if (projectSlug) return projectSlug;
  const name = cleanText(facts?.name);
  return name ? slugify(name) : null;
}

async function assertKnownProjectTargetAccess(
  deps: StudioDeps,
  actor: StudioActor,
  projectSlug: string | null | undefined,
  facts: StudioProjectFacts | undefined,
): Promise<void> {
  const slug = knownProjectSlug(projectSlug, facts);
  if (!slug) return;
  const existing = await deps.data.findProjectBySlug(slug);
  if (existing)
    assertObjectAccess(actor, await deps.data.getObjectCreatedBy("project", existing.id));
}

function warningSummaries(warnings: ProgressiveWarning[]): StudioWarningSummary[] {
  return warnings.map((warning) => ({ code: warning.code, message: redact(warning.message) }));
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
// UNPUBLISHED INGESTION (FOREVER-STUDIO-UNPUBLISHED-INGESTION-001)
// ---------------------------------------------------------------------------

/**
 * THE SERVER-ENFORCED POLICY: Studio ingestion never publishes.
 *
 * `studio_publish_project(p_publish := false)` leaves publication entirely to
 * `forever_progressive_ingest`, whose own create path has always written
 * `public_status = 'draft'` ("saved, NEVER auto-published") and whose enrich
 * path changes `public_status` only when the batch carries an explicit
 * top-level `project.publish`. Studio's ingestion batches never carry one — see
 * `assertUnpublishedIngestionPayload` — so an enrich preserves whatever status
 * the project already had.
 *
 * This is a CONSTANT, deliberately not a setting, an argument or a flag. There
 * is no code path, request field, environment variable or stored job value that
 * can make ingestion publish. Publication happens only through
 * `setProjectPublication`, which is separately authenticated and separately
 * audited, and which is the sole remaining producer of a
 * `project.publish = true` batch (`publicationPatchBatch`).
 */
const INGESTION_PUBLISHES = false;

/**
 * TWO DIFFERENT QUESTIONS, deliberately not one predicate.
 *
 * `isPubliclyVisible` is the RLS predicate the public projection uses
 * (`20260718113000_progressive_ingestion_v1.sql`: `is_active = true AND
 * public_status = 'published'`). It answers "can an anonymous visitor read this
 * RIGHT NOW?", and it is what a UI surface reports as `isPublic`.
 *
 * `isPublishedProject` answers "is this project's publication state PUBLISHED?"
 * — the column alone, with no reference to `is_active`.
 *
 * The ingestion collision guard must use the SECOND one. `is_active = false`
 * only means a published project is not visible at this moment; it does not
 * make it a safe ingestion target, because reactivating it — a separate,
 * ordinary operation that touches only `is_active` — would immediately expose
 * whatever an upload had silently written into its graph. Guarding on
 * visibility would therefore leave exactly the hole this change exists to
 * close, merely deferred until the project is switched back on.
 */
function isPubliclyVisible(project: { public_status: string; is_active: boolean }): boolean {
  return project.is_active && isPublishedProject(project);
}

function isPublishedProject(project: { public_status: string }): boolean {
  return project.public_status === "published";
}

/**
 * FAIL CLOSED: no ingestion batch may carry a publication decision.
 *
 * Ingestion field maps are built from two allow-lists (`manualProjectFields`,
 * `projectFieldsFromFacts`), neither of which can emit `publish` — so reaching
 * this throw means a payload was assembled from something other than those
 * allow-lists. That is exactly the case that must not be tolerated silently:
 * on a create the payload is spread to the batch top level (`{ slug, ...fields
 * }`), which is the precise position `forever_progressive_ingest` reads
 * `publish` from on enrich.
 *
 * Rejecting rather than stripping is the point. A stripped value is an accepted
 * value that happened not to take effect; a rejected one proves ingestion never
 * accepted a publication instruction at all. Not retryable: the same payload
 * would be rejected identically forever.
 *
 * Exported so `unpublished-ingestion.test.ts` can prove the backstop directly.
 * It is unreachable while both allow-lists hold, and a test that could only
 * reach it by breaking them would be testing the mock, not the guard.
 */
export function assertUnpublishedIngestionPayload(project: ProgressiveProjectPayload): void {
  if (!("publish" in project)) return;
  throw new StudioError(
    "studio_ingestion_publication_rejected",
    safeMessageFor("studio_ingestion_publication_rejected"),
    false,
  );
}

/**
 * FAIL CLOSED on a collision with a PUBLISHED project.
 *
 * Keyed on `public_status` alone — see `isPublishedProject`. A published but
 * currently inactive project is still a published project, and is still
 * refused.
 *
 * Called before the batch is built and before any write, so a published
 * project's graph is never touched: no automatic unpublish, no silent update of
 * live public content, and no ambiguous duplicate (the slug is the identity, so
 * there is no second row to create). The repository has no isolated
 * draft-revision mechanism — there is one `projects` row per slug and every
 * enrich mutates it in place — so there is no safe way to absorb this upload,
 * and inventing one is not this change's job.
 *
 * Not retryable: an automatic retry would re-collide identically. THE ONE
 * SUPPORTED RECOVERY is an explicit Owner-controlled unpublish
 * (`setProjectPublication`) before the upload is retried. Re-uploading the same
 * real project under a different name is NOT offered as a remedy: it would
 * create a second row for one real project — the ambiguous duplicate this guard
 * exists to prevent.
 */
function assertNoPublishedProjectCollision(project: { public_status: string }): void {
  if (!isPublishedProject(project)) return;
  throw new StudioError(
    "studio_published_project_collision",
    safeMessageFor("studio_published_project_collision"),
    false,
  );
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
  sourceRole: StudioRole,
  suppliedAt: string,
): ManualProjectFields {
  const fields: Record<string, unknown> = {};
  const provenance: FieldProvenanceMap = {};
  if (!raw) return { fields, provenance };
  const status = roleProvenanceStatus(sourceRole);
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
    // The material purpose is a ROUTING INSTRUCTION from the browser, so it is
    // re-checked here against the closed allowlist rather than taken on trust
    // — the endpoint schema already rejects a missing or unknown value, and
    // this second, INDEPENDENT check keeps the guarantee for every other
    // caller of this service, including internal ones that never pass through
    // the endpoint. A new direct upload always came from a window, so an
    // omitted purpose is a refusal here too, never a fall-through to guessing.
    // The whole job is refused before any row or signed target exists, so a
    // request mixing one valid and one invalid file writes nothing at all.
    assertNewDirectMaterialPurpose(file.materialPurpose);
  }
  const projectSlug = cleanText(input.projectSlug);
  if (projectSlug && !SLUG_PATTERN.test(projectSlug)) {
    throw new StudioAccessError("project_slug_invalid");
  }
  // An explicit slug (or deterministic slug from manual name) can mean a
  // new record or an update. When it already exists, authorize it BEFORE
  // allocating a job or signed upload targets, so a publisher cannot use an
  // update route against another publisher's project as a staging side channel.
  await assertKnownProjectTargetAccess(deps, actor, projectSlug, input.projectFacts);

  // The job id is server-generated by the database default; create then read
  // its id back so every staging path is job-scoped.
  const declaredFilesInput = files.map((file) => ({
    name: file.name,
    size: file.size,
    contentType: file.contentType,
    materialPurpose: file.materialPurpose,
  }));
  // The write provider is decided ONCE, here, and then persisted. Every later
  // read of this job — processing, retry, resume, the scheduled runner,
  // cleanup — uses the persisted value, so changing the deployment setting can
  // never relocate a job that is already in flight. An unrecognized configured
  // value refuses the job before any row, object or upload target exists.
  const storageProvider = deps.storageProviders.writeProviderId;
  const provider = deps.storageProviders.get(storageProvider);
  // A submission that ALSO carries large archives is refused as one thing.
  //
  // The archives themselves are planned later, on their own endpoint, so
  // without this the browser would have to create the ordinary job first and
  // only then discover the lane is closed — leaving a half-made upload behind
  // and asking the Owner to clean it up. Declaring them here keeps the whole
  // submission atomic: the entire request is refused before the job row, the
  // staging paths and the signed targets exist, exactly as an invalid material
  // purpose already is.
  //
  // The declaration is the browser's, so it is not trusted for anything: it
  // cannot create an archive, and omitting it buys nothing, because the plan
  // endpoint refuses independently. It is trusted only to make an HONEST
  // client's refusal atomic.
  for (const archive of input.archives ?? []) {
    if (!cleanText(archive.name)) throw new StudioAccessError("file_name_required");
    assertNewDirectMaterialPurpose(archive.materialPurpose);
  }
  if ((input.archives ?? []).length > 0) {
    assertArchiveControlPlaneAvailable(provider);
  }
  const jobId = crypto.randomUUID();
  const declared = declareNewDirectJobFiles(jobId, declaredFilesInput, storageProvider);
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
    processing_requested_at: null,
    content_fingerprint: null,
    facts: {
      ...(input.projectFacts ? { projectFacts: input.projectFacts } : {}),
      ...(input.resaleFacts ? { resaleFacts: input.resaleFacts } : {}),
      // Server-private storage decision, in the job's existing facts JSONB —
      // no migration, no new column, and never a browser-visible value.
      ...jobStorageFacts(storageProvider),
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

  // Each signed target carries the SERVER's identity for the file it belongs
  // to — its position in the declared manifest, which is also the index inside
  // its private staging path. The browser pairs bytes to targets by that
  // identity, so this response may be reordered without a single byte reaching
  // another file's path, and two files with the same name stay distinct.
  const uploads: StudioUploadTarget[] = [];
  for (const [fileIndex, file] of declared.entries()) {
    // The transport is a short-lived, single-object credential. It is returned
    // to the caller and nowhere else: not persisted, not audited, not logged.
    const allocation = await provider.allocateOrdinaryUpload({
      jobId,
      fileIndex,
      bucket: file.stagingBucket,
      path: file.stagingPath,
      contentType: file.declaredType,
    });
    uploads.push({
      name: file.name,
      fileIndex,
      bucket: allocation.bucket,
      path: allocation.path,
      // Legacy top-level token stays populated on the Supabase lane so an older
      // browser build keeps working; the R2 lane has no token at all.
      ...(allocation.transport.kind === "supabase_signed"
        ? { token: allocation.transport.token }
        : {}),
      transport: allocation.transport,
    });
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
      // WHICH system this job's bytes go to. Provider identity only — never an
      // endpoint, a bucket name, an object key or a signed URL.
      storage_provider: storageProvider,
    },
  });
  return { jobId, uploads };
}

// ---------------------------------------------------------------------------
// Job processing: claim → gather → atomic ingest → finalize
// ---------------------------------------------------------------------------

function jobResultFromRow(job: StudioJobRow): StudioJobResult {
  const stored = (job.result_summary ?? {}) as Partial<StudioJobResult>;
  return {
    jobId: job.id,
    // The persisted state machine says 'published' for any finished job. This
    // is the boundary where that legacy internal value stops.
    status: externalJobStatus(job.status),
    workflow: job.workflow,
    attemptCount: job.attempt_count,
    pagePath: stored.pagePath ?? null,
    projectSlug: stored.projectSlug ?? job.project_slug,
    listingId: stored.listingId ?? job.listing_id,
    publicStatus: stored.publicStatus ?? null,
    counts: stored.counts ?? null,
    warnings: stored.warnings ?? [],
    errorCode: job.error_code,
    errorStage: jobErrorStage(job),
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
  assertObjectAccess(actor, job.created_by);
  return claimAndProcess(deps, actor, job, true);
}

/**
 * Read the exact current state of one owned job without claiming, resuming, or
 * otherwise changing it. This is the observation half of an explicit Owner
 * retry: the mutation happens once, and every later request is read-only.
 */
export async function getUploadJobStatus(
  deps: StudioDeps,
  actor: StudioActor,
  jobId: string,
): Promise<StudioJobResult> {
  const job = await deps.data.getJob(jobId);
  if (!job) {
    throw new StudioAccessError("job_not_found", "This upload job no longer exists.");
  }
  assertObjectAccess(actor, job.created_by);
  return jobResultFromRow(job);
}

// ---------------------------------------------------------------------------
// Large-archive uploads: plan (resumable part targets) / confirm / progress
// ---------------------------------------------------------------------------

async function requireJobAccess(
  deps: StudioDeps,
  actor: StudioActor,
  jobId: string,
): Promise<StudioJobRow> {
  const job = await deps.data.getJob(jobId);
  if (!job) throw new StudioAccessError("job_not_found");
  assertObjectAccess(actor, job.created_by);
  return job;
}

export async function planJobArchiveUpload(
  deps: StudioDeps,
  actor: StudioActor,
  input: StudioArchivePlanInput,
): Promise<StudioArchivePlanResult> {
  assertNotPartnerDemo(deps);
  // A large archive is a NEW direct upload that happens to need a different
  // transport, so it is held to exactly the same closed allowlist as an
  // ordinary direct file — re-checked here independently of the endpoint
  // schema, and BEFORE the job is even looked up, so no archive row, no signed
  // part target and no private Storage allocation can precede it.
  assertNewDirectMaterialPurpose(input.materialPurpose);
  const job = await requireJobAccess(deps, actor, input.jobId);
  // Same pre-authorization as processing: a denied known target must not
  // allocate private staging parts or signed targets as a side channel.
  await assertKnownProjectTargetAccess(
    deps,
    actor,
    job.project_slug,
    job.facts.projectFacts as StudioProjectFacts | undefined,
  );
  // The archive travels on the job's OWN provider, never the current global
  // write-provider setting: an archive added to an in-flight job goes exactly
  // where the rest of that job went.
  const provider = deps.storageProviders.get(jobStorageProvider(job));
  // The resumable lane needs an authoritative part listing, which a Worker's
  // R2 bindings cannot produce. Refused HERE — authenticated, authorized, and
  // before `planArchiveUpload` creates the multipart upload, the archive row
  // or a single signed part target.
  assertArchiveControlPlaneAvailable(provider);
  const plan = await planArchiveUpload(deps, provider, job, input);
  await recordAuditSafely(deps, {
    actor_id: actor.userId,
    actor_email: actor.email,
    action: "studio_archive_planned",
    table_name: "studio_archives",
    record_id: plan.archiveId,
    metadata: { job_id: job.id, parts: plan.partCount, resumed: plan.presentParts.length > 0 },
  });
  return plan;
}

export async function confirmJobArchiveUpload(
  deps: StudioDeps,
  actor: StudioActor,
  input: StudioArchiveConfirmInput,
): Promise<StudioArchiveConfirmResult> {
  assertNotPartnerDemo(deps);
  const job = await requireJobAccess(deps, actor, input.jobId);
  const provider = deps.storageProviders.get(jobStorageProvider(job));
  // Confirmation is where the part listing is actually consulted, so it is
  // refused on the same terms as planning — before any part-state read,
  // completion call or archive-row transition.
  assertArchiveControlPlaneAvailable(provider);
  const result = await confirmArchiveUpload(deps, provider, job, input);
  if (result.accepted) {
    await recordAuditSafely(deps, {
      actor_id: actor.userId,
      actor_email: actor.email,
      action: "studio_archive_accepted",
      table_name: "studio_archives",
      record_id: result.archiveId,
      metadata: { job_id: job.id },
    });
  }
  return result;
}

export async function getJobProgress(
  deps: StudioDeps,
  actor: StudioActor,
  jobId: string,
): Promise<StudioJobProgress> {
  const job = await requireJobAccess(deps, actor, jobId);
  return buildJobProgress(deps, job);
}

/**
 * Automatic durable resume. Called on every dashboard poll (and safe for a
 * scheduled worker/cron to call) to pick up explicitly-ready received,
 * retryable-failed, or stale-processing jobs and drive them to completion.
 * A pristine received manifest is intentionally inert until the browser's
 * processing request confirms that all intended uploads are done.
 */
export async function resumeDueJobs(
  deps: StudioDeps,
  actor: StudioActor,
): Promise<StudioResumeResult> {
  if (deps.partnerDemoActive()) return { resumed: 0, results: [] };
  const due = await deps.data.listDueJobs(
    STALE_PROCESSING_SECONDS,
    RESUME_BATCH,
    actor.role === "owner" ? undefined : actor.userId,
  );
  const results: StudioJobResult[] = [];
  for (const job of due) {
    // Bounded automatic retries: a job that has exhausted its automatic budget
    // is not claimed, not counted and not touched. Only a person restarts it.
    if (automaticRetryBudgetExhausted(job)) continue;
    try {
      results.push(await claimAndProcess(deps, actor, job));
    } catch (error) {
      // Eligibility can change after the query (or a malformed row can reach
      // this boundary). Each pre-claim failure is isolated: the job remains
      // untouched and unrelated eligible work continues. Never include ids,
      // facts, paths, or other private job fields in the log context.
      logStudioFailure("automatic_resume_job_skipped", error);
    }
  }
  return { resumed: results.filter((r) => r.status === "completed").length, results };
}

// ---------------------------------------------------------------------------
// Scheduled background runner (no browser session, no user token)
// ---------------------------------------------------------------------------

/** Slice advancements one scheduled invocation may perform (bounded work). */
export const SCHEDULED_TICK_MAX_SLICES = 12;

export interface StudioScheduledTickResult {
  /** Explicitly processing-requested jobs the tick saw as due. */
  due: number;
  /** Claim-scoped slice advancements performed. */
  advanced: number;
  /**
   * Jobs that reached their terminal SUCCESS state on this tick. Named for
   * completion, not publication: a project ingestion completes without
   * publishing anything (FOREVER-STUDIO-UNPUBLISHED-INGESTION-001), so a
   * `published=` counter in the scheduler's log line would assert something
   * that did not happen.
   */
  completed: number;
  failed: number;
  /** Jobs skipped pre-claim (claim lost, membership change, malformed row). */
  skipped: number;
}

/**
 * Execution principals for a SCHEDULED attempt: authorization is (as always)
 * the job creator's CURRENT active membership, and the attempt executes under
 * that same membership's authority — the Owner/Trusted Publisher upload
 * remains the INGESTION authorization; the scheduler adds none of its own, and
 * neither authorizes publication.
 * Audit metadata records executed_via=scheduled_runner truthfully.
 */
async function resolveScheduledJobPrincipals(
  deps: StudioDeps,
  job: StudioJobRow,
): Promise<StudioJobPrincipals> {
  if (!job.created_by) throw new StudioAccessError("studio_membership_required");
  const membership = await deps.data.getMembership(job.created_by);
  if (!membership?.is_active) throw new StudioAccessError("studio_membership_required");
  const authorization: StudioActor = {
    userId: membership.user_id,
    email: membership.email,
    role: membership.role,
    displayName: membership.display_name,
  };
  return {
    source: { userId: job.created_by, email: job.creator_email, role: job.creator_role },
    authorization,
    execution: authorization,
    executionVia: "scheduled_runner",
  };
}

/**
 * One scheduled background tick. Invoked by the Cloudflare Cron Trigger
 * through the Worker's `scheduled()` export (Nitro cloudflare-module preset)
 * via the `cloudflare:scheduled` runtime hook — see scheduled.plugin.ts.
 * Runs with server-only credentials; there is NO HTTP endpoint, NO user Auth
 * token, and NO browser session involved.
 *
 * Claims ONLY explicitly processing-requested jobs (studio_list_due_jobs
 * enforces processing_requested_at + a currently active source membership
 * before its LIMIT), uses the ordinary single-winner claim (never
 * requestJobProcessing — the runner never marks readiness itself), advances
 * bounded claim-scoped slices, and stops at its per-invocation slice budget.
 * A per-job failure is isolated; the tick itself never throws.
 */
export async function runScheduledStudioTick(
  deps: StudioDeps,
  options: { maxJobs?: number; maxSlices?: number } = {},
): Promise<StudioScheduledTickResult> {
  const result: StudioScheduledTickResult = {
    due: 0,
    advanced: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  };
  if (deps.partnerDemoActive()) return result;
  const maxJobs = options.maxJobs ?? RESUME_BATCH;
  const maxSlices = options.maxSlices ?? SCHEDULED_TICK_MAX_SLICES;
  let slices = 0;

  const due = await deps.data.listDueJobs(STALE_PROCESSING_SECONDS, maxJobs, undefined);
  result.due = due.length;

  for (const job of due) {
    // The cap the runaway pilot loop needed. A job whose automatic budget is
    // spent is skipped before it is claimed, so the scheduler stops selecting
    // it entirely rather than re-failing it every five minutes forever.
    if (automaticRetryBudgetExhausted(job)) {
      result.skipped += 1;
      continue;
    }
    let current: StudioJobRow = job;
    for (;;) {
      if (slices >= maxSlices) return result;
      try {
        const principals = await resolveScheduledJobPrincipals(deps, current);
        await assertKnownProjectTargetAccess(
          deps,
          principals.authorization,
          current.project_slug,
          current.facts.projectFacts as StudioProjectFacts | undefined,
        );
        if (current.status === "published" && current.result_summary) break;
        const token = deps.newToken();
        const claimed = await deps.data.claimJob(current.id, token, STALE_PROCESSING_SECONDS);
        if (!claimed) {
          result.skipped += 1;
          break;
        }
        slices += 1;
        result.advanced += 1;
        const outcome = await processClaimedJob(
          deps,
          principals.execution,
          claimed,
          token,
          { ...principals },
          // Nobody asked for this attempt: the cron did. It spends the bounded
          // automatic budget, exactly like the dashboard's background resume.
          { attemptKind: "automatic" },
        );
        if (outcome.status === "completed") {
          result.completed += 1;
          break;
        }
        if (outcome.status !== "processing") {
          result.failed += 1;
          break;
        }
        // The slice released the claim with work remaining — continue this
        // job immediately (still inside the tick's slice budget).
        const refreshed = await deps.data.getJob(current.id);
        if (!refreshed) break;
        current = refreshed;
      } catch (error) {
        result.skipped += 1;
        // Same redaction rule as automatic resume: never log job fields.
        logStudioFailure("scheduled_tick_job_skipped", error);
        break;
      }
    }
  }
  return result;
}

async function claimAndProcess(
  deps: StudioDeps,
  actor: StudioActor,
  jobRow: StudioJobRow,
  requestProcessing = false,
): Promise<StudioJobResult> {
  // Resolve the job creator's CURRENT active membership before claiming or
  // touching storage. The immutable creator_role snapshot is deliberately not
  // consulted here: it is historical provenance, never authorization.
  const principals = await resolveJobPrincipals(deps, actor, jobRow);
  // Do this before claiming a job: a denied known target must not change job
  // state, create public media, or otherwise leave a database/storage trace.
  await assertKnownProjectTargetAccess(
    deps,
    principals.authorization,
    jobRow.project_slug,
    jobRow.facts.projectFacts as StudioProjectFacts | undefined,
  );
  // Re-entry after success is a read, not a re-publication.
  if (jobRow.status === "published" && jobRow.result_summary) {
    return jobResultFromRow(jobRow);
  }

  // An explicit per-job processing request is a CONTROLLED attempt: a person
  // asked for this one, now. Background resumption is automatic and bounded.
  const attemptKind: StudioAttemptKind = requestProcessing ? "controlled" : "automatic";
  if (attemptKind === "automatic" && automaticRetryBudgetExhausted(jobRow)) {
    // The automatic lane has spent its budget on this job. Leave it exactly as
    // it is — claimed by nobody, attempt count untouched, failure visible — and
    // wait for a person. A controlled attempt is still accepted.
    return jobResultFromRow(jobRow);
  }
  const token = deps.newToken();
  const claimed = requestProcessing
    ? await deps.data.requestJobProcessing(jobRow.id, token, STALE_PROCESSING_SECONDS)
    : await deps.data.claimJob(jobRow.id, token, STALE_PROCESSING_SECONDS);
  if (!claimed) {
    // Already completed, terminally failed, or freshly held by another worker.
    const current = await deps.data.getJob(jobRow.id);
    if (!current) throw new StudioAccessError("job_not_found");
    return jobResultFromRow(current);
  }
  return processClaimedJob(deps, actor, claimed, token, principals, { attemptKind });
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
  provider: StudioStorageProvider,
  objects: Array<{ bucket: string; path: string }>,
): Promise<void> {
  const byBucket = new Map<string, string[]>();
  for (const object of objects) {
    const paths = byBucket.get(object.bucket) ?? [];
    paths.push(object.path);
    byBucket.set(object.bucket, paths);
  }
  for (const [bucket, paths] of byBucket) {
    await provider.objects.remove(bucket, paths).catch(() => undefined);
  }
}

/**
 * Post-commit hygiene by the winning attempt: remove every token-scoped
 * public object of this job that is NOT referenced by the committed
 * publication — i.e. not among the winner's own uploads and not owned by a
 * durably settled archive-entry row (entries published by earlier slices
 * under earlier claim tokens are page media and must survive). Failures here
 * are logged and never affect the committed publication.
 */
async function cleanupUnreferencedJobObjects(
  provider: StudioStorageProvider,
  jobId: string,
  referenced: ReadonlySet<string>,
): Promise<void> {
  const prefix = publicJobPrefix(jobId);
  for (const bucket of PUBLIC_MEDIA_BUCKETS) {
    try {
      const children = await provider.objects.listNames(bucket, prefix);
      for (const child of children) {
        const inner = await provider.objects.listNames(bucket, `${prefix}/${child}`);
        const paths = inner.size
          ? [...inner].map((name) => `${prefix}/${child}/${name}`)
          : [`${prefix}/${child}`];
        const orphans = paths.filter((path) => !referenced.has(`${bucket}/${path}`));
        if (orphans.length) await provider.objects.remove(bucket, orphans);
      }
    } catch (error) {
      logStudioFailure("orphan_cleanup_deferred", error);
    }
  }
}

/** Keys of every public object the committed publication references. */
function referencedObjectKeys(
  materials: GatheredMaterials,
  archiveObjects: Array<{ bucket: string; path: string }>,
): Set<string> {
  const keys = new Set<string>();
  for (const object of materials.publicObjects) keys.add(`${object.bucket}/${object.path}`);
  for (const object of archiveObjects) keys.add(`${object.bucket}/${object.path}`);
  return keys;
}

/**
 * Merge durable large-archive outcomes into the attempt's gathered materials.
 * Archives settle first in strict deterministic order, so their adopted
 * price list / facts win over a same-upload ordinary file; media appends
 * after the ordinary items with continuous sort order.
 */
function mergeComposedIntoMaterials(
  materials: GatheredMaterials,
  composed: ComposedArchiveMaterials,
): void {
  const base = materials.media.length;
  for (const item of composed.media) {
    materials.media.push({ ...item, sort_order: (item.sort_order ?? 0) + base });
  }
  materials.photoUrls.push(...composed.photoUrls);
  if (!materials.firstPhotoUrl) materials.firstPhotoUrl = composed.firstPhotoUrl;
  if (!materials.firstBrochureUrl) materials.firstBrochureUrl = composed.firstBrochureUrl;
  if (composed.priceList) {
    if (materials.priceList) {
      materials.warnings.push({
        entity: "price",
        code: "price_list_duplicate_ignored",
        severity: "warning",
        message:
          "The price list extracted from an uploaded archive was applied; a separately uploaded price list was retained but not applied.",
      });
    }
    materials.priceList = composed.priceList;
    materials.priceListSource = composed.priceListSource;
  }
  if (composed.factFields && !materials.factFields) materials.factFields = composed.factFields;
  if (composed.derivedName && !materials.derivedName) materials.derivedName = composed.derivedName;
  materials.warnings.push(...composed.warnings);
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
  resolvedPrincipals?: StudioJobPrincipals,
  options: { attemptKind?: StudioAttemptKind } = {},
): Promise<StudioJobResult> {
  // Direct worker callers of this exported boundary receive the same current-
  // membership authorization as the normal claim path, before storage reads or
  // copies. Normal callers pass the already-resolved pre-claim principals.
  const principals = resolvedPrincipals ?? (await resolveJobPrincipals(deps, actor, claimed));
  // Unmarked callers are treated as AUTOMATIC, which is the conservative
  // default: an unattributed attempt spends the bounded budget rather than
  // silently acquiring the unbounded rights of an Owner-initiated one.
  const attemptKind: StudioAttemptKind = options.attemptKind ?? "automatic";
  const providerId = jobStorageProvider(claimed);
  let provider: StudioStorageProvider | undefined;
  let materials: GatheredMaterials | undefined;
  // Set the moment the atomic ingestion transaction commits. From then on
  // this attempt's public objects belong to the committed project and must
  // never be removed, and the job must never be reported as failed.
  const commitState = { committed: false };
  const heartbeat = makeHeartbeat(deps, claimed.id, token);
  // Public objects owned by durably settled archive entries (any attempt).
  // They are page media once publication commits and are NEVER cleanup
  // candidates; they are populated only after every archive is terminal.
  let archiveObjects: Array<{ bucket: string; path: string }> = [];
  try {
    // THE no-fallback point. The provider comes from the job's own persisted
    // record — not from the current deployment setting, and never re-chosen on
    // a retry, a resume, or a scheduled continuation. If that provider is
    // unavailable the attempt fails closed; there is no path that quietly
    // processes an R2 job against Supabase Storage or the reverse.
    //
    // Resolved INSIDE the guarded region on purpose. A provider that refuses —
    // missing credentials, a Worker with no usable bucket binding, an
    // unrecognized id — used to throw past this try block entirely, so
    // `failJob` never ran and the job sat `processing`, claimed, forever. Now
    // every refusal reaches a truthful terminal state with a
    // `provider_resolution` stage on it.
    provider = await inStage("provider_resolution", async () =>
      deps.storageProviders.get(jobStorageProvider(claimed)),
    );
    // Large-archive lane first: advance one bounded, claim-scoped slice of
    // part verification / directory indexing / entry routing. When budgets
    // end the slice with work remaining, release the claim so the very next
    // poll — from this browser, any signed-in Studio session, or a scheduled
    // caller — claims and continues from the durable entry checkpoints.
    const slice = await runArchiveSlice(deps, provider, claimed, token, heartbeat);
    if (slice.pendingWork) {
      await deps.data.releaseJobIfClaimed(claimed.id, token);
      return {
        jobId: claimed.id,
        status: "processing",
        workflow: claimed.workflow,
        attemptCount: claimed.attempt_count,
        pagePath: null,
        projectSlug: claimed.project_slug,
        listingId: claimed.listing_id,
        publicStatus: null,
        counts: null,
        warnings: [],
        errorCode: null,
        errorStage: null,
        error: null,
        retryable: true,
        progress: await buildJobProgress(deps, { ...claimed, status: "processing" }),
      };
    }
    // Every archive is terminal: compose the durable entry outcomes into
    // publishable materials, then verify and gather the ordinary files.
    let composed: ComposedArchiveMaterials | undefined;
    if (slice.archiveCount > 0) {
      composed = await composeArchiveMaterials(deps, claimed, 0);
      archiveObjects = composed.referencedPublicObjects;
    }
    materials = await gatherMaterials(deps, claimed, {
      provider,
      token,
      heartbeat,
      seedHashes: composed?.settledHashes,
    });
    if (composed) mergeComposedIntoMaterials(materials, composed);
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
        ? await finalizeResale(
            deps,
            provider,
            principals,
            claimed,
            materials,
            token,
            commitState,
            archiveObjects,
          )
        : await finalizeProject(
            deps,
            provider,
            principals,
            claimed,
            materials,
            token,
            commitState,
            archiveObjects,
          );
    return result;
  } catch (error) {
    const safe = toSafeError(error, mapFailureCode(error));

    if (commitState.committed) {
      // The ingestion committed; a later error (audit, hygiene) must never
      // fail the result or remove the committed project's media.
      logStudioFailure("post_commit_error_ignored", error);
      try {
        const current = await deps.data.getJob(claimed.id);
        if (current) return jobResultFromRow(current);
      } catch (readError) {
        logStudioFailure("post_commit_read_failed", readError);
      }
      return {
        ...jobResultFromRow(claimed),
        status: "completed",
        warnings: materials ? warningSummaries(materials.warnings) : [],
      };
    }

    // Not committed by us (as far as we observed). Re-read the job before
    // touching storage: if it reached its terminal state, only delete our
    // copies when the recorded winning attempt is provably a DIFFERENT attempt
    // — if our own commit landed but its response was lost, our objects ARE the
    // project's media and must be kept. If the job state cannot be read, retain our
    // objects (deterministic retention: the winner's post-commit sweep
    // removes foreign prefixes) rather than risk deleting committed media.
    let currentState: StudioJobRow | null | undefined;
    try {
      currentState = await deps.data.getJob(claimed.id);
    } catch {
      currentState = undefined;
    }
    // Provider resolution itself can fail now that it is inside the guarded
    // region, and an attempt with no provider has, by construction, written
    // nothing to clean up.
    if (currentState?.status === "published") {
      const winner = (currentState.result_summary as { attempt?: string } | null)?.attempt;
      if (
        provider &&
        winner &&
        winner !== attemptPrefixFromToken(token) &&
        materials?.publicObjects.length
      ) {
        await removeGroupedByBucket(provider, materials.publicObjects);
      }
      return jobResultFromRow(currentState);
    }
    if (provider && currentState !== undefined && materials?.publicObjects.length) {
      await removeGroupedByBucket(provider, materials.publicObjects);
    }

    // Bounded automatic retries. A CONTROLLED attempt (an Owner pressing Retry,
    // or the first processing request after an upload) resets the budget; an
    // AUTOMATIC one spends it. Reaching the cap makes the job non-retryable, so
    // the scheduler's own due-job predicate stops returning it — while
    // `attempt_count`, the error code, the stage and the message all stay
    // exactly as true as they were.
    const nextFailures = nextAutomaticFailureCount(claimed, attemptKind);
    const retryable = retryableAfterFailure({
      failureRetryable: safe.retryable,
      nextAutomaticFailures: nextFailures,
    });
    const telemetry = buildStageTelemetry({
      provider: providerId,
      error,
      code: safe.code,
      attempt: claimed.attempt_count,
      retryable,
      workflow: claimed.workflow,
      fallbackStage: provider ? "terminal_transition" : "provider_resolution",
    });
    await persistAttemptTelemetry(deps, claimed, token, telemetry, nextFailures);

    await deps.data
      .failJob({
        jobId: claimed.id,
        token,
        errorCode: safe.code,
        message: safe.message,
        retryable,
      })
      .catch(() => undefined);
    return {
      jobId: claimed.id,
      status: "failed",
      workflow: claimed.workflow,
      attemptCount: claimed.attempt_count,
      pagePath: null,
      projectSlug: claimed.project_slug,
      listingId: claimed.listing_id,
      publicStatus: null,
      counts: null,
      warnings: materials ? warningSummaries(materials.warnings) : [],
      errorCode: safe.code,
      errorStage: telemetry.stage,
      error: safe.message,
      retryable,
    };
  }
}

/**
 * Record the ALLOWLISTED stage telemetry and the automatic-retry budget on the
 * job, while this attempt still holds the claim.
 *
 * Claim-checked like every other processing write, merged into `facts` so no
 * other fact is disturbed, and never fatal: telemetry that failed to save must
 * not turn a diagnosable failure into an undiagnosable one. The same values —
 * and only those values — also reach the server log, so a deployment that
 * cannot read the database can still see which stage stopped.
 */
async function persistAttemptTelemetry(
  deps: StudioDeps,
  claimed: StudioJobRow,
  token: string,
  telemetry: StudioStageTelemetry,
  automaticFailures: number,
): Promise<void> {
  console.error(`[studio] processing_stage_failure ${stageTelemetryLogLine(telemetry)}`);
  try {
    await deps.data.updateJobIfClaimed(claimed.id, token, {
      facts: {
        ...claimed.facts,
        [JOB_PROCESSING_FACTS_KEY]: telemetry,
        ...retryFactsPatch(automaticFailures),
      },
    });
  } catch (error) {
    logStudioFailure("processing_telemetry_write_failed", error);
  }
}

/**
 * The safe internal code one failure collapses to.
 *
 * A stage-labelled failure keeps its stage's code, which is the whole point: a
 * server-side object HEAD that never reached storage is `object_stat_failed`,
 * not the `processing_failed` that every failure in the system used to share.
 * The legacy substring rules stay for errors raised by code that predates the
 * stage vocabulary.
 */
function mapFailureCode(error: unknown): string {
  const stage = stageOf(error);
  if (stage) return STUDIO_STAGE_FAILURE_CODES[stage];
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
  provider: StudioStorageProvider,
  principals: StudioJobPrincipals,
  job: StudioJobRow,
  materials: GatheredMaterials,
  token: string,
  commitState: { committed: boolean },
  archiveObjects: Array<{ bucket: string; path: string }> = [],
): Promise<StudioJobResult> {
  const suppliedAt = job.created_at;
  const manual = manualProjectFields(
    job.facts.projectFacts as StudioProjectFacts | undefined,
    principals.source.role,
    suppliedAt,
  );
  const extracted = materials.factFields;

  const fields: Record<string, unknown> = { ...(extracted?.fields ?? {}), ...manual.fields };
  const provenance: FieldProvenanceMap = { ...(extracted?.provenance ?? {}), ...manual.provenance };

  const manualName = typeof manual.fields.name === "string" ? manual.fields.name : undefined;
  const slug = deriveProjectSlug(job, manualName, materials.derivedName);
  const existing = await deps.data.findProjectBySlug(slug);
  if (existing) {
    assertObjectAccess(
      principals.authorization,
      await deps.data.getObjectCreatedBy("project", existing.id),
    );
    // BEFORE the batch is built and before any write. An upload that lands on
    // ANY published project stops here with that project untouched — including
    // one currently switched off (`is_active = false`), which is invisible
    // right now but is still published.
    assertNoPublishedProjectCollision(existing);
  }
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
  // The create branch spreads `fields` to the batch top level — the exact
  // position a publication decision would be read from. Nothing may arrive there.
  assertUnpublishedIngestionPayload(project);

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
    // Which attempt's token-scoped storage objects the COMMITTED INGESTION
    // references — lets every cleanup path tell the winner's objects from
    // orphans. Nothing here is published; these are the project's media.
    attempt: attemptPrefixFromToken(token),
  };

  // ONE atomic transaction: ingest graph + finalize job. It does NOT publish —
  // see INGESTION_PUBLISHES. `summary.public_status` is therefore the ingest's
  // own verdict: 'draft' for a create, and the project's unchanged prior status
  // for an enrich (which, by the collision guard above, is never 'published').
  const summary = await deps.data.publishProject({
    jobId: job.id,
    token,
    batch,
    publish: INGESTION_PUBLISHES,
    result: resultPayload,
  });
  commitState.committed = true;

  if (summary.replayed) {
    // Another attempt already completed this job; our token-scoped copies
    // are orphans (the project references the winner's paths). Remove only ours
    // — never the durably settled archive-entry objects, which the winner's
    // committed ingestion references.
    await removeGroupedByBucket(provider, materials.publicObjects);
  } else {
    // We won: sweep every job object the COMMITTED INGESTION does not
    // reference (foreign attempts' orphans), then audit. Both are post-commit
    // hygiene — non-destructive to the committed project and non-fatal on
    // failure.
    await cleanupUnreferencedJobObjects(
      provider,
      job.id,
      referencedObjectKeys(materials, archiveObjects),
    );
    await recordAuditSafely(deps, {
      actor_id: principals.execution.userId,
      actor_email: principals.execution.email,
      // Never "…_published": this transaction publishes nothing. The audit log
      // is the record an Owner reads back to learn what became public, so it
      // must not attribute a publication to an upload.
      action: mode === "create" ? "studio_project_created_draft" : "studio_project_updated_draft",
      table_name: "projects",
      record_id: summary.project_id,
      metadata: {
        job_id: job.id,
        workflow: job.workflow,
        mode,
        counts: summary.counts,
        ...jobPrincipalAuditMetadata(principals),
      },
    });
  }

  return {
    jobId: job.id,
    // The job COMPLETED. It did not publish: `publicStatus` below carries the
    // only publication claim this result makes, and for a project it is 'draft'.
    status: "completed",
    workflow: job.workflow,
    attemptCount: job.attempt_count,
    pagePath: resultPayload.pagePath,
    projectSlug: slug,
    listingId: null,
    publicStatus: summary.public_status,
    counts: summary.counts,
    warnings: resultPayload.warnings,
    errorCode: null,
    errorStage: null,
    error: null,
    retryable: true,
  };
}

// ---------------------------------------------------------------------------
// Resale listings: publish without a complete project record; private contact
// ---------------------------------------------------------------------------

function manualListingProvenance(
  facts: StudioResaleFacts,
  sourceRole: StudioRole,
  suppliedAt: string,
): FieldProvenanceMap {
  const status = roleProvenanceStatus(sourceRole);
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
  provider: StudioStorageProvider,
  principals: StudioJobPrincipals,
  job: StudioJobRow,
  materials: GatheredMaterials,
  token: string,
  commitState: { committed: boolean },
  archiveObjects: Array<{ bucket: string; path: string }> = [],
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
      fieldProvenance: manualListingProvenance(facts, principals.source.role, suppliedAt),
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
    await removeGroupedByBucket(provider, materials.publicObjects);
  } else {
    await cleanupUnreferencedJobObjects(
      provider,
      job.id,
      referencedObjectKeys(materials, archiveObjects),
    );
    await recordAuditSafely(deps, {
      actor_id: principals.execution.userId,
      actor_email: principals.execution.email,
      action: "studio_resale_published",
      table_name: "listings",
      record_id: published.listingId,
      metadata: {
        job_id: job.id,
        photos: materials.photoUrls.length,
        ...jobPrincipalAuditMetadata(principals),
      },
    });
  }

  return {
    jobId: job.id,
    // Completed — and for the resale lane it also genuinely published, which
    // `publicStatus: "published"` below is what says so.
    status: "completed",
    workflow: job.workflow,
    attemptCount: job.attempt_count,
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
    errorStage: null,
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
  const project = await requireProjectAccess(deps, actor, input.slug);
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
  const project = await requireProjectAccess(deps, actor, input.slug);
  const manual = manualProjectFields(input.facts, actor.role, deps.now());
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

// ---------------------------------------------------------------------------
// Project amenities (FOREVER-STUDIO-AMENITIES-CORE-001)
// ---------------------------------------------------------------------------

/** One amenity as the editor submits it: slug identity plus editorial fields. */
export interface StudioProjectAmenityInput {
  slug: string;
  note: string;
  isFeatured: boolean;
  sortOrder: number;
}

/** One canonical amenity the Owner explicitly asked to create in this save. */
export interface StudioCreatedAmenityInput {
  name: string;
  slug: string;
  category: string;
  icon: string;
}

/** The kebab-case shape a canonical amenity slug must have, per the migration. */
const AMENITY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A refused amenity save. Never retryable: every one of these is a deterministic
 * property of the submitted set, so the same request would be refused again —
 * and the UI must offer a correction, not a retry.
 */
function amenityRefusal(code: string, message: string): StudioError {
  return new StudioError(code, message, false);
}

/**
 * Validate the complete requested set BEFORE the transaction runs.
 *
 * Defence in depth, not the enforcement point: `studio_save_project_amenities`
 * re-checks every rule below inside the transaction, which is what actually
 * protects the data. Checking here as well buys two things the database cannot
 * give: the codes are raised with a sentence the Owner can act on rather than a
 * bare SQL sentinel, and an unsaveable set never opens a transaction or takes a
 * row lock on the project.
 *
 * The codes match the SQL sentinels one-for-one, so any given refusal is named
 * the same whichever layer raised it. What is NOT guaranteed is WHICH refusal a
 * multi-fault payload produces: this walks entry-major (every rule for entry
 * one, then entry two), while the function walks check-major (one rule across
 * all entries, then the next). A payload that is both mis-slugged and
 * mis-categorised can therefore be named differently by the two. That is
 * harmless in practice — this layer always runs first, so the Owner only ever
 * sees its answer — but it is worth stating rather than implying the two are
 * interchangeable. `FakeData` mirrors the FUNCTION's order, so the fake-versus-
 * SQL equivalence the service tests rely on is exact.
 */
function assertProjectAmenitiesValid(
  amenities: StudioProjectAmenityInput[],
  createdAmenities: StudioCreatedAmenityInput[],
): void {
  const seen = new Set<string>();
  for (const entry of amenities) {
    const slug = entry.slug.trim();
    if (!slug) {
      throw amenityRefusal(
        "studio_project_amenities_slug_required",
        "Every selected amenity needs an identifier.",
      );
    }
    if (seen.has(slug)) {
      throw amenityRefusal(
        "studio_project_amenities_duplicate_slug",
        "The same amenity was selected twice.",
      );
    }
    seen.add(slug);
    // The upper bound is not cosmetic. Above int4 the function's `::integer`
    // cast raises a raw `value out of range`, which reaches the browser as the
    // generic retryable failure — a permanent refusal dressed up as a transient
    // one. Refusing it here names the reason.
    if (
      !Number.isInteger(entry.sortOrder) ||
      entry.sortOrder < 0 ||
      entry.sortOrder > STUDIO_MAX_AMENITY_SORT_ORDER
    ) {
      throw amenityRefusal(
        "studio_project_amenities_invalid_sort_order",
        "Amenity order positions must be whole numbers between zero and 1,000,000.",
      );
    }
  }

  // At most 8 featured. A public page that leads with everything leads with
  // nothing — the same reason the migration states.
  const featured = amenities.filter((entry) => entry.isFeatured).length;
  if (featured > STUDIO_MAX_FEATURED_AMENITIES) {
    throw amenityRefusal(
      "studio_project_amenities_featured_limit",
      "At most 8 amenities can be featured.",
    );
  }

  const createdSlugs = new Set<string>();
  for (const created of createdAmenities) {
    const slug = created.slug.trim();
    if (!slug || !created.name.trim()) {
      throw amenityRefusal(
        "studio_amenity_name_and_slug_required",
        "A new amenity needs both a name and an identifier.",
      );
    }
    if (!AMENITY_SLUG_PATTERN.test(slug)) {
      throw amenityRefusal(
        "studio_amenity_slug_invalid",
        "An amenity identifier must be lower-case words joined by single hyphens.",
      );
    }
    if (createdSlugs.has(slug)) {
      throw amenityRefusal(
        "studio_amenity_slug_duplicate",
        "The same new amenity identifier was submitted twice.",
      );
    }
    // Category is required on creation and must come from the closed vocabulary.
    // The public page groups by category, so free text turns one heading into
    // three across three projects and the grouping stops meaning anything.
    // Existing catalogue rows are unaffected — this constrains creation only.
    if (!isStudioAmenityCategory(created.category.trim())) {
      throw amenityRefusal(
        "studio_amenity_category_invalid",
        "A new amenity needs one of the supported categories.",
      );
    }
    createdSlugs.add(slug);
  }

  // A created amenity must be one this project is selecting. `amenities` is a
  // shared catalogue with no delete path, so a row created and then not used is
  // permanent clutter for every project — exactly what the editor's close-match
  // warning exists to prevent, but reachable straight past it. Creation is a
  // side effect of selecting something that does not exist yet.
  for (const slug of createdSlugs) {
    if (!seen.has(slug)) {
      throw amenityRefusal(
        "studio_amenity_created_unused",
        "A new amenity can only be created as part of selecting it for this project.",
      );
    }
  }
}

/**
 * The catalogue plus this project's current selection, for the editor's
 * first render.
 *
 * Read-only, so it runs for any actor with access to the project — a Trusted
 * Publisher may see what a project offers. Only the SAVE is Owner-only.
 */
export async function getProjectAmenities(
  deps: StudioDeps,
  actor: StudioActor,
  input: { slug: string },
): Promise<{
  slug: string;
  catalogue: StudioAmenityCatalogueRow[];
  selected: StudioProjectAmenityRow[];
}> {
  assertNotPartnerDemo(deps);
  const project = await requireProjectAccess(deps, actor, input.slug);
  const [catalogue, selected] = await Promise.all([
    deps.data.listAmenityCatalogue(),
    deps.data.listProjectAmenities(project.id),
  ]);
  return { slug: input.slug, catalogue, selected };
}

/**
 * Reconcile one project's canonical amenity set in a single transaction.
 *
 * Owner-only, and asserted here as well as inside the function. The role is a
 * property of the ACTOR, so the server boundary can refuse before any project
 * row is locked; the in-transaction check is what makes the guarantee
 * unbypassable. Neither is redundant — removing either one would leave a path
 * (a future non-endpoint caller, or a direct service-role connection) that the
 * other does not cover.
 *
 * What comes back is the transaction's canonical state, never the caller's
 * input: notes are trimmed, sort orders defaulted, newly created slugs resolved
 * to real rows, and the whole set already in public display order. An editor
 * that re-hydrated from its own optimistic value would drift from the page it
 * just published.
 */
export async function saveProjectAmenities(
  deps: StudioDeps,
  actor: StudioActor,
  input: {
    slug: string;
    amenities: StudioProjectAmenityInput[];
    createdAmenities: StudioCreatedAmenityInput[];
  },
): Promise<{
  slug: string;
  selected: StudioProjectAmenityRow[];
  selectedCount: number;
  featuredCount: number;
  createdAmenitySlugs: string[];
}> {
  assertNotPartnerDemo(deps);
  const project = await requireProjectAccess(deps, actor, input.slug);
  assertOwner(actor);
  assertProjectAmenitiesValid(input.amenities, input.createdAmenities);

  const saved = await deps.data.saveProjectAmenities({
    projectId: project.id,
    actorId: actor.userId,
    // The EXACT final set. An empty array is valid and clears the project's
    // amenities; it is never read as "no change".
    amenities: input.amenities.map((entry) => ({
      amenity_slug: entry.slug.trim(),
      note: entry.note,
      is_featured: entry.isFeatured,
      sort_order: entry.sortOrder,
    })),
    createdAmenities: input.createdAmenities.map((created) => ({
      name: created.name.trim(),
      slug: created.slug.trim(),
      category: created.category,
      icon: created.icon,
    })),
    suppliedAt: deps.now(),
    injectFailure: false,
  });

  await recordAuditSafely(deps, {
    actor_id: actor.userId,
    actor_email: actor.email,
    action: "studio_project_amenities_saved",
    table_name: "project_amenities",
    record_id: project.id,
    // Counts and slugs only. A note is project editorial copy that belongs on
    // the project row, not duplicated into an append-only audit trail nothing
    // ever edits.
    metadata: {
      slug: input.slug,
      selected: saved.selectedCount,
      featured: saved.featuredCount,
      created: saved.createdAmenitySlugs,
    },
  });

  return {
    slug: input.slug,
    selected: saved.amenities,
    selectedCount: saved.selectedCount,
    featuredCount: saved.featuredCount,
    createdAmenitySlugs: saved.createdAmenitySlugs,
  };
}

export async function setProjectHeroImage(
  deps: StudioDeps,
  actor: StudioActor,
  input: { slug: string; url: string },
): Promise<{ slug: string }> {
  assertNotPartnerDemo(deps);
  await requireProjectAccess(deps, actor, input.slug);
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
  await requireListingAccess(deps, actor, input.listingId);
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
  await requireListingAccess(deps, actor, input.listingId);
  const suppliedAt = deps.now();
  const fields: Record<string, string | number> = {};

  for (const { factKey, kind } of RESALE_FIELD_COLUMNS) {
    const raw = input.facts[factKey];
    let value: unknown = kind === "number" ? cleanNumber(raw) : cleanText(raw);
    if (factKey === "currency" && typeof value === "string") {
      const upper = value.toUpperCase();
      if (!/^[A-Z]{3}$/.test(upper)) continue;
      value = upper;
    }
    if (value === undefined) continue;

    fields[factKey] = value as string | number;
  }

  // Private contact is routed to the private table, never to the public row.
  // It is not provenance-ranked, but it commits in the same transaction as
  // public facts, provenance, and conflict warnings.
  const contact: Record<string, string> = {};
  const contactName = cleanText(input.facts.contactName);
  const contactPhone = cleanText(input.facts.contactPhone);
  const contactEmail = cleanText(input.facts.contactEmail);
  if (contactName !== undefined) contact.contact_name = contactName;
  if (contactPhone !== undefined) contact.contact_phone = contactPhone;
  if (contactEmail !== undefined) contact.contact_email = contactEmail;

  const updated = await deps.data.updateResale({
    listingId: input.listingId,
    actorId: actor.userId,
    fields,
    contact,
    suppliedAt,
  });
  // Conflict warnings were persisted transactionally by updateResale: they
  // remain truthful, visible Studio records and never become a gate.
  await recordAuditSafely(deps, {
    actor_id: actor.userId,
    actor_email: actor.email,
    action: "studio_listing_updated",
    table_name: "listings",
    record_id: input.listingId,
    metadata: {
      fields: updated.appliedFields,
      contact: Object.keys(contact).length > 0,
      conflicts: updated.warnings.map((warning) => warning.field),
    },
  });
  return { listingId: input.listingId, warnings: warningSummaries(updated.warnings) };
}

// ---------------------------------------------------------------------------
// Dashboard + detail (prefill) + membership
// ---------------------------------------------------------------------------

export async function getProjectDetail(
  deps: StudioDeps,
  actor: StudioActor,
  slug: string,
): Promise<StudioProjectDetail | null> {
  await requireProjectAccess(deps, actor, slug);
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
    // Visibility, not publication state: exactly the public RLS predicate.
    // Deliberately NOT the predicate the ingestion collision guard uses — see
    // `isPubliclyVisible` vs `isPublishedProject`.
    isPublic: isPubliclyVisible(row),
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
  actor: StudioActor,
  listingId: string,
): Promise<StudioListingDetail | null> {
  await requireListingAccess(deps, actor, listingId);
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
  const createdBy = actor.role === "owner" ? undefined : actor.userId;
  const [projects, listings, jobs, activeJobs] = await Promise.all([
    deps.data.listProjects(createdBy),
    deps.data.listListings(createdBy),
    deps.data.listJobs(25, createdBy),
    deps.data.countActiveJobs(createdBy),
  ]);
  const members = actor.role === "owner" ? await deps.data.listMembers() : [];
  // Operational-history isolation is enforced by the data query before its
  // limit: the Owner sees all jobs, while a Publisher receives only their own
  // errors, creator email, and staging metadata.
  return {
    session: {
      userId: actor.userId,
      email: actor.email,
      role: actor.role,
      displayName: actor.displayName,
    },
    // What the upload form may offer, derived on the SERVER from the storage
    // plane a new job would actually be created on. A closed two-value enum
    // and nothing else: no provider id, no runtime, no binding, no bucket.
    capabilities: {
      archiveUpload: archiveUploadCapabilityFor(deps.storageProviders),
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
      // Job summaries cross to the browser: convert the persisted value.
      status: externalJobStatus(job.status),
      projectSlug: job.project_slug,
      listingId: job.listing_id,
      creatorEmail: job.creator_email,
      createdAt: job.created_at,
      errorCode: job.error_code,
      errorStage: jobErrorStage(job),
      error: job.error,
      retryable: job.retryable,
      // The two lanes, reported separately. `retryable` says whether ANY lane
      // may claim the job; this says whether the automatic one has given up on
      // it — which is the difference between "still working on it" and "waiting
      // for you". Collapsing them is what let the dashboard promise background
      // progress that was never going to happen.
      automaticRetry: automaticRetryState(job),
      attemptCount: job.attempt_count,
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
