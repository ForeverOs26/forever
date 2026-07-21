/**
 * Forever Studio — server orchestration (FOREVER-STUDIO-001).
 *
 * One narrow layer between the authenticated publisher and the existing
 * progressive ingestion lane. It reuses — never reimplements — the batch
 * builder, provenance precedence, dependency resolution, listing draft
 * builder, and the atomic `forever_progressive_ingest` RPC.
 *
 * Durable product rule enforced here:
 *   An upload by an authenticated Owner or Trusted Publisher IS direct
 *   publication authorization. Incomplete business data never creates a
 *   follow-on approval or publication gate. Missing facts become warnings
 *   and absent fields; unreadable files are retained; failures leave a
 *   retryable job. The only hard requirements are technical (a project
 *   needs an addressable identity; files must land in storage).
 */

import { randomUUID } from "node:crypto";

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
  type StudioJobResult,
  type StudioOverview,
  type StudioProjectFacts,
  type StudioResaleFacts,
  type StudioUploadTarget,
  type StudioWarningSummary,
} from "../studio-types";
import {
  StudioAccessError,
  type StudioActor,
  type StudioDeps,
  type StudioJobRow,
} from "./contracts";
import { declareJobFiles, gatherMaterials, type GatheredMaterials } from "./extraction";
import { assertNotPartnerDemo, assertOwner } from "./membership";

export const MAX_JOB_FILES = 60;
export const MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GiB per file
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TEXT_LIMIT = 4000;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function actorProvenanceStatus(actor: StudioActor): ProvenanceStatus {
  return actor.role === "owner" ? "owner_verified" : "partner_provided";
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

/** A deterministic, self-fingerprinting batch (used for tiny publish patches). */
function sealedBatch(body: Omit<ProgressiveBatch, "batch_fingerprint">): ProgressiveBatch {
  return { ...body, batch_fingerprint: fingerprintBatch(body) };
}

function publicationPatchBatch(
  slug: string,
  publish: boolean,
  suppliedAt: string,
): ProgressiveBatch {
  return sealedBatch({
    schema_version: "1",
    mode: "enrich",
    project: {
      slug,
      publish,
      field_provenance: {
        public_status: { status: "owner_verified", supplied_at: suppliedAt },
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
// Job creation: declare files, hand out signed upload targets
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
    if (typeof file.size === "number" && file.size > MAX_FILE_BYTES) {
      throw new StudioAccessError("file_too_large", `${file.name} exceeds the 1 GB limit.`);
    }
  }
  const projectSlug = cleanText(input.projectSlug);
  if (projectSlug && !SLUG_PATTERN.test(projectSlug)) {
    throw new StudioAccessError("project_slug_invalid");
  }

  const jobId = randomUUID();
  const declared = declareJobFiles(jobId, files);
  const job: StudioJobRow = {
    id: jobId,
    created_by: actor.userId,
    creator_email: actor.email,
    creator_role: actor.role,
    workflow: input.workflow,
    project_slug: projectSlug ?? null,
    listing_id: null,
    status: "received",
    facts: {
      ...(input.projectFacts ? { projectFacts: input.projectFacts } : {}),
      ...(input.resaleFacts ? { resaleFacts: input.resaleFacts } : {}),
    },
    files: declared,
    result_summary: null,
    error: null,
    attempt_count: 0,
    created_at: deps.now(),
  };
  await deps.data.createJob(job);

  const uploads: StudioUploadTarget[] = [];
  for (const file of declared) {
    const { token } = await deps.storage.createSignedUpload(file.bucket, file.path);
    uploads.push({ name: file.name, bucket: file.bucket, path: file.path, token });
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
// Job processing: extract → build → ingest → publish (no follow-on gate)
// ---------------------------------------------------------------------------

function jobResultFromSummary(job: StudioJobRow): StudioJobResult {
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
    error: job.error,
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
  // Re-entry after success is a read, not a second publication.
  if (job.status === "published" && job.result_summary) {
    return jobResultFromSummary(job);
  }
  await deps.data.updateJob(jobId, {
    status: "processing",
    attempt_count: job.attempt_count + 1,
    error: null,
  });

  try {
    const materials = await gatherMaterials(deps, job);
    const result =
      job.workflow === "resale_listing"
        ? await processResaleJob(deps, actor, job, materials)
        : await processProjectJob(deps, actor, job, materials);
    await deps.data.updateJob(jobId, {
      status: "published",
      files: materials.files,
      project_slug: result.projectSlug,
      listing_id: result.listingId,
      result_summary: result as unknown as Record<string, unknown>,
      error: null,
    });
    return result;
  } catch (error) {
    // The job stays retryable; batch fingerprints make the retry idempotent.
    const message = error instanceof Error ? error.message : String(error);
    await deps.data.updateJob(jobId, { status: "failed", error: message });
    return {
      jobId,
      status: "failed",
      workflow: job.workflow,
      pagePath: null,
      projectSlug: job.project_slug,
      listingId: job.listing_id,
      publicStatus: null,
      counts: null,
      warnings: [],
      error: message,
    };
  }
}

async function processProjectJob(
  deps: StudioDeps,
  actor: StudioActor,
  job: StudioJobRow,
  materials: GatheredMaterials,
): Promise<StudioJobResult> {
  const suppliedAt = job.created_at;
  const manual = manualProjectFields(
    job.facts.projectFacts as StudioProjectFacts | undefined,
    actor,
    suppliedAt,
  );
  const extracted = materials.factFields;

  // Extracted facts first, manual entry on top (and ranked higher anyway).
  const fields: Record<string, unknown> = { ...(extracted?.fields ?? {}), ...manual.fields };
  const provenance: FieldProvenanceMap = {
    ...(extracted?.provenance ?? {}),
    ...manual.provenance,
  };

  const slug = job.project_slug ?? (typeof fields.name === "string" ? slugify(fields.name) : null);
  if (!slug) {
    throw new StudioAccessError(
      "project_identity_required",
      "Enter a project name or choose an existing project so the upload has an address.",
    );
  }

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
    fields.name = titleFromSlug(slug);
    provenance.name = { status: "inferred", note: "derived_from_slug", supplied_at: suppliedAt };
    extraWarnings.push({
      entity: "project",
      field: "name",
      code: "project_name_derived",
      severity: "warning",
      message: `No project name was provided; "${fields.name}" was derived from the slug for display.`,
    });
  }

  const existingState = mode === "enrich" ? await deps.fetchExisting(slug) : undefined;

  // Blank-filling only: an uploaded photo/brochure never replaces an
  // existing cover image or brochure link.
  const existingValues = existingState?.project?.values ?? {};
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
      ? ({
          slug,
          ...fields,
          field_provenance: provenance,
        } as ProgressiveProjectPayload)
      : {
          slug,
          set: fields,
          field_provenance: provenance,
          // Direct publication: the authorized upload IS the publish decision.
          publish: true,
        };

  const batch = await buildProgressiveBatch(deps.reader, {
    mode,
    project,
    priceList: materials.priceList,
    countryEvidence: extracted?.countryEvidence,
    media: materials.media,
    existing: existingState,
    extraWarnings,
  });
  const summary = await deps.ingest.ingest(batch);

  let publicStatus = summary.public_status;
  if (mode === "create") {
    // The RPC deliberately never auto-publishes a create; Studio's second,
    // deterministic patch applies the publisher's direct authorization.
    const published = await deps.ingest.ingest(publicationPatchBatch(slug, true, suppliedAt));
    publicStatus = published.public_status;
  }

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
    pagePath: projectPagePath(slug),
    projectSlug: slug,
    listingId: null,
    publicStatus,
    counts: summary.counts,
    warnings: warningSummaries(batch.warnings ?? []),
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Resale listings: publish without requiring a complete project record
// ---------------------------------------------------------------------------

function manualListingProvenance(
  facts: StudioResaleFacts,
  actor: StudioActor,
  suppliedAt: string,
): FieldProvenanceMap {
  const status = actorProvenanceStatus(actor);
  const provenance: FieldProvenanceMap = {};
  for (const [key, value] of Object.entries(facts)) {
    if (value === undefined || value === null || value === "") continue;
    provenance[key] = { status, supplied_at: suppliedAt, note: "studio_manual_entry" };
  }
  return provenance;
}

async function processResaleJob(
  deps: StudioDeps,
  actor: StudioActor,
  job: StudioJobRow,
  materials: GatheredMaterials,
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
      severity: "warning",
      message: `No title was provided; "${title}" was derived for display.`,
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
      contactName: cleanText(facts.contactName),
      contactPhone: cleanText(facts.contactPhone),
      contactEmail: cleanText(facts.contactEmail),
      fieldProvenance: manualListingProvenance(facts, actor, suppliedAt),
    },
  );
  warnings.push(...draft.warnings);

  // Deterministic per-job slug: retries land on the same listing.
  const slug = `${slugify(title).slice(0, 60) || "resale"}-${job.id.slice(0, 8)}`;
  let listingId = job.listing_id;
  if (!listingId) {
    const orphan = await deps.data.findListingBySlug(slug);
    if (orphan) listingId = orphan.id;
  }

  const row = { ...draft.row, slug, publication_status: "published" };
  if (listingId) {
    await deps.data.updateListing(listingId, row as unknown as Record<string, unknown>);
  } else {
    const inserted = await deps.data.insertListing(row);
    listingId = inserted.id;
  }
  if (warnings.length) {
    await deps.data.insertListingWarnings(listingId, warnings);
  }

  await deps.data.recordAudit({
    actor_id: actor.userId,
    actor_email: actor.email,
    action: "studio_resale_published",
    table_name: "listings",
    record_id: listingId,
    metadata: { job_id: job.id, photos: materials.photoUrls.length },
  });

  return {
    jobId: job.id,
    status: "published",
    workflow: job.workflow,
    pagePath: resalePagePath(slug),
    projectSlug: null,
    listingId,
    publicStatus: "published",
    counts: {
      buildings: 0,
      units: 0,
      prices: 0,
      media: materials.photoUrls.length,
      warnings: warnings.length,
    },
    warnings: warningSummaries(warnings),
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Direct actions: publish / unpublish / edit
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
    publicationPatchBatch(input.slug, input.publish, deps.now()),
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
    project: {
      slug: input.slug,
      set: manual.fields,
      field_provenance: manual.provenance,
    },
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
  const listing = await deps.data.getListing(input.listingId);
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
  put("contact_name", cleanText(input.facts.contactName));
  put("contact_phone", cleanText(input.facts.contactPhone));
  put("contact_email", cleanText(input.facts.contactEmail));
  const currency = cleanText(input.facts.currency)?.toUpperCase();
  if (currency && /^[A-Z]{3}$/.test(currency)) patch.currency = currency;
  if (Object.keys(patch).length === 0) return { listingId: input.listingId };
  patch.field_provenance = {
    ...((listing as unknown as { field_provenance?: FieldProvenanceMap }).field_provenance ?? {}),
    ...manualListingProvenance(input.facts, actor, deps.now()),
  };
  await deps.data.updateListing(input.listingId, patch);
  await deps.data.recordAudit({
    actor_id: actor.userId,
    actor_email: actor.email,
    action: "studio_listing_updated",
    table_name: "listings",
    record_id: input.listingId,
    metadata: { fields: Object.keys(patch) },
  });
  return { listingId: input.listingId };
}

// ---------------------------------------------------------------------------
// Dashboard + membership management
// ---------------------------------------------------------------------------

export async function getOverview(deps: StudioDeps, actor: StudioActor): Promise<StudioOverview> {
  const [projects, listings, jobs] = await Promise.all([
    deps.data.listProjects(),
    deps.data.listListings(),
    deps.data.listJobs(25),
  ]);
  const members = actor.role === "owner" ? await deps.data.listMembers() : [];
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
      error: job.error,
    })),
    members: members.map((member) => ({
      userId: member.user_id,
      role: member.role,
      email: member.email,
      displayName: member.display_name,
      isActive: member.is_active,
    })),
  };
}

export async function inviteMember(
  deps: StudioDeps,
  actor: StudioActor,
  input: { email: string; password: string; displayName?: string },
): Promise<{ userId: string }> {
  assertNotPartnerDemo(deps);
  assertOwner(actor);
  const email = cleanText(input.email)?.toLowerCase();
  if (!email || !email.includes("@")) throw new StudioAccessError("invite_email_invalid");
  const password = input.password ?? "";
  if (password.length < 10) {
    throw new StudioAccessError(
      "invite_password_too_short",
      "Choose a password of at least 10 characters.",
    );
  }
  let userId = await deps.authAdmin.findUserIdByEmail(email);
  if (!userId) {
    userId = (await deps.authAdmin.createUser(email, password)).id;
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
    metadata: { email, role: "trusted_publisher" },
  });
  return { userId };
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
