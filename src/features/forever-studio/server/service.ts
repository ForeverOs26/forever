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
import type { FieldProvenanceMap, ProvenanceStatus } from "@/features/forever-ingestion/provenance";
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
  type StudioDeps,
  type StudioJobRow,
  type StudioListingPublishRow,
  type StudioPrivateContact,
} from "./contracts";
import { StudioError, toSafeError } from "./errors";
import {
  declareJobFiles,
  gatherMaterials,
  MAX_UPLOAD_BYTES,
  type GatheredMaterials,
} from "./extraction";
import { assertNotPartnerDemo, assertOwner } from "./membership";

export const MAX_JOB_FILES = 60;
export { MAX_UPLOAD_BYTES };
/** A processing claim older than this is considered abandoned and resumable. */
export const STALE_PROCESSING_SECONDS = 900; // 15 minutes
/** Jobs auto-resumed per dashboard poll / cron tick. */
export const RESUME_BATCH = 5;
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
  await deps.data.recordAudit({
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
    // Already published, or freshly held by another worker.
    const current = await deps.data.getJob(jobRow.id);
    if (!current) throw new StudioAccessError("job_not_found");
    return jobResultFromRow(current);
  }

  let materials: GatheredMaterials | undefined;
  try {
    materials = await gatherMaterials(deps, claimed);
    // Persist the observed file records (size, sha256, media class, status);
    // this is diagnostic metadata, not part of the publication transaction.
    await deps.data.updateJob(claimed.id, { files: materials.files });
    const result =
      claimed.workflow === "resale_listing"
        ? await finalizeResale(deps, actor, claimed, materials, token)
        : await finalizeProject(deps, actor, claimed, materials, token);
    return result;
  } catch (error) {
    const safe = toSafeError(error, mapFailureCode(error));
    // Item 4: a failed job exposes no public object — remove anything copied
    // this attempt. Retry re-copies deterministically.
    if (materials?.publicObjects.length) {
      await deps.storage
        .remove(
          materials.publicObjects[0].bucket,
          materials.publicObjects.map((o) => o.path),
        )
        .catch(() => undefined);
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
  };

  // ONE atomic transaction: ingest graph + publish + finalize job.
  const summary = await deps.data.publishProject({
    jobId: job.id,
    token,
    batch,
    publish: true,
    result: resultPayload,
  });

  await deps.data.recordAudit({
    actor_id: actor.userId,
    actor_email: actor.email,
    action: mode === "create" ? "studio_project_created_published" : "studio_project_updated",
    table_name: "projects",
    record_id: summary.project_id,
    metadata: { job_id: job.id, workflow: job.workflow, mode, counts: summary.counts },
  });

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

  await deps.data.recordAudit({
    actor_id: actor.userId,
    actor_email: actor.email,
    action: "studio_resale_published",
    table_name: "listings",
    record_id: published.listingId,
    metadata: { job_id: job.id, photos: materials.photoUrls.length },
  });

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
  await deps.data.recordAudit({
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
  await deps.data.recordAudit({
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
  await deps.data.recordAudit({
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
  await deps.data.recordAudit({
    actor_id: actor.userId,
    actor_email: actor.email,
    action: input.publish ? "studio_listing_published" : "studio_listing_unpublished",
    table_name: "listings",
    record_id: input.listingId,
    metadata: {},
  });
  return { listingId: input.listingId, publicationStatus };
}

export async function updateResaleListing(
  deps: StudioDeps,
  actor: StudioActor,
  input: { listingId: string; facts: StudioResaleFacts },
): Promise<{ listingId: string }> {
  assertNotPartnerDemo(deps);
  const listing = await deps.data.getListingDetail(input.listingId);
  if (!listing) throw new StudioAccessError("listing_not_found");
  const patch: Record<string, unknown> = {};
  const put = (column: string, value: unknown) => {
    if (value !== undefined) patch[column] = value;
  };
  put("title", cleanText(input.facts.title));
  put("project_name_raw", cleanText(input.facts.projectName));
  put("location_name_raw", cleanText(input.facts.locationText));
  put("property_type", cleanText(input.facts.propertyType));
  put("bedrooms", cleanNumber(input.facts.bedrooms));
  put("bathrooms", cleanNumber(input.facts.bathrooms));
  put("area_sqm", cleanNumber(input.facts.areaSqm));
  put("price", cleanNumber(input.facts.price));
  put("description", cleanText(input.facts.description));
  const currency = cleanText(input.facts.currency)?.toUpperCase();
  if (currency && /^[A-Z]{3}$/.test(currency)) patch.currency = currency;

  // Private contact — routed to the private table, never to the public row.
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
    patch.field_provenance = {
      ...((listing as unknown as { field_provenance?: FieldProvenanceMap }).field_provenance ?? {}),
      ...manualListingProvenance(input.facts, actor, deps.now()),
    };
    await deps.data.updateListing(input.listingId, patch);
  }
  await deps.data.recordAudit({
    actor_id: actor.userId,
    actor_email: actor.email,
    action: "studio_listing_updated",
    table_name: "listings",
    record_id: input.listingId,
    metadata: { fields: Object.keys(patch), contact: contactTouched },
  });
  return { listingId: input.listingId };
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
  const [projects, listings, jobs] = await Promise.all([
    deps.data.listProjects(),
    deps.data.listListings(),
    deps.data.listJobs(25),
  ]);
  const members = actor.role === "owner" ? await deps.data.listMembers() : [];
  const activeJobs = jobs.filter(
    (job) =>
      (actor.role === "owner" || job.created_by === actor.userId) &&
      (job.status === "received" ||
        job.status === "processing" ||
        (job.status === "failed" && job.retryable)),
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
  await deps.data.recordAudit({
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
  await deps.data.recordAudit({
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
