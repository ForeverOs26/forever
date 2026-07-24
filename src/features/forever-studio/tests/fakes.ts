/**
 * In-memory Forever Studio dependency fakes.
 *
 * The progressive RPC is the existing FakeIngestExecutor (a statement-for-
 * statement mirror of the verified migration). The studio_* transaction
 * functions are modelled here with a snapshot/rollback so the orchestrator
 * tests exercise the SAME atomic, idempotent, concurrency-safe contract the
 * production SQL enforces; the real SQL is additionally covered by the
 * PostgreSQL suite (studio.postgres.sql).
 */

import { createHash } from "node:crypto";

import type { ProgressiveWarning } from "@/features/forever-ingestion/batch-types";
import type { ExistingProjectState } from "@/features/forever-ingestion/build-batch";
import { mediaStateKey, priceStateKey } from "@/features/forever-ingestion/build-batch";
import type {
  DependencyCandidate,
  DependencyReader,
} from "@/features/forever-ingestion/dependency-resolution";
import {
  canReplaceField,
  type FieldProvenance,
  type FieldProvenanceMap,
} from "@/features/forever-ingestion/provenance";
import { FakeIngestExecutor } from "@/features/forever-ingestion/tests/fake-ingest-executor";

import { syntheticJpeg, syntheticPng, syntheticWebp } from "./media-truth-fixtures";

import {
  UPLOAD_MANIFEST_DOMAIN,
  type StudioArchiveEntryState,
  type StudioArchiveStatus,
} from "../studio-types";

import type {
  PriceListPdfExtraction,
  StudioActor,
  StudioArchiveEntryOutcome,
  StudioArchiveEntryRow,
  StudioArchiveRow,
  StudioAuditEntry,
  StudioData,
  StudioDeps,
  StudioJobRow,
  StudioListingDetailRow,
  StudioListingRow,
  StudioMembershipRow,
  StudioObjectStat,
  StudioPrivateContact,
  StudioProjectDetailRow,
  StudioProjectRow,
  StudioStorage,
} from "../server/contracts";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export class FakeStorage implements StudioStorage {
  objects = new Map<string, Buffer>();
  contentTypes = new Map<string, string>();
  signedUploads: string[] = [];
  /** Force the next public derivative upload to throw once. */
  failCopyOnce = false;
  /** Force remove to throw once (models a crash before cleanup could run). */
  failRemoveOnce = false;
  /** Every hashObject call, for streaming-verification assertions. */
  hashedPaths: string[] = [];

  private key(bucket: string, path: string): string {
    return `${bucket}/${path}`;
  }

  /** Simulates the browser upload to a signed URL. */
  put(bucket: string, path: string, data: Buffer | string, contentType?: string): void {
    this.objects.set(this.key(bucket, path), Buffer.isBuffer(data) ? data : Buffer.from(data));
    if (contentType) this.contentTypes.set(this.key(bucket, path), contentType);
  }

  async createSignedUpload(bucket: string, path: string): Promise<{ token: string }> {
    this.signedUploads.push(this.key(bucket, path));
    return { token: `signed-${path}` };
  }

  async listNames(bucket: string, prefix: string): Promise<Set<string>> {
    // Mirrors Supabase list(): direct child FILES by name, and direct child
    // FOLDERS as their first path segment.
    const names = new Set<string>();
    const fullPrefix = `${bucket}/${prefix}/`;
    for (const key of this.objects.keys()) {
      if (!key.startsWith(fullPrefix)) continue;
      const rest = key.slice(fullPrefix.length);
      names.add(rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : rest);
    }
    return names;
  }

  async statObject(bucket: string, path: string): Promise<StudioObjectStat | null> {
    const buf = this.objects.get(this.key(bucket, path));
    return buf ? { size: buf.length } : null;
  }

  async hashObject(
    bucket: string,
    path: string,
    headBytes: number,
  ): Promise<{ sha256: string; size: number; head: Buffer } | null> {
    const buf = this.objects.get(this.key(bucket, path));
    if (!buf) return null;
    this.hashedPaths.push(this.key(bucket, path));
    const { createHash } = await import("node:crypto");
    return {
      sha256: createHash("sha256").update(buf).digest("hex"),
      size: buf.length,
      head: Buffer.from(buf.subarray(0, headBytes)),
    };
  }

  async downloadWithin(bucket: string, path: string, maxBytes: number): Promise<Buffer | null> {
    const buf = this.objects.get(this.key(bucket, path));
    if (!buf) return null;
    if (buf.length > maxBytes) return null;
    return buf;
  }

  async readObjectStream(
    bucket: string,
    path: string,
    onChunk: (chunk: Buffer) => void | Promise<void>,
  ): Promise<number | null> {
    const buf = this.objects.get(this.key(bucket, path));
    if (!buf) return null;
    // Bounded 64 KiB views, mirroring the production transport stream.
    for (let start = 0; start < buf.length; start += 64 * 1024) {
      await onChunk(buf.subarray(start, Math.min(buf.length, start + 64 * 1024)));
    }
    return buf.length;
  }

  async upload(bucket: string, path: string, data: Buffer, contentType?: string): Promise<void> {
    if (this.failCopyOnce && bucket !== "studio-uploads") {
      this.failCopyOnce = false;
      throw new Error("storage derivative upload failed (injected)");
    }
    // Defensive copy: production serializes to the network, so the caller may
    // hand over a view of a larger internal buffer without retaining it.
    this.objects.set(this.key(bucket, path), Buffer.from(data));
    if (contentType) this.contentTypes.set(this.key(bucket, path), contentType);
  }

  async remove(bucket: string, paths: string[]): Promise<void> {
    if (this.failRemoveOnce) {
      this.failRemoveOnce = false;
      throw new Error("storage remove failed (injected)");
    }
    for (const path of paths) {
      this.objects.delete(this.key(bucket, path));
      this.contentTypes.delete(this.key(bucket, path));
    }
  }

  publicUrl(bucket: string, path: string): string {
    return `https://cdn.test/${bucket}/${path}`;
  }

  /** Object keys currently present in a public bucket (for privacy assertions). */
  publicKeys(bucket: string): string[] {
    const prefix = `${bucket}/`;
    return [...this.objects.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }

  publicContentType(bucket: string, path: string): string | undefined {
    return this.contentTypes.get(this.key(bucket, path));
  }

  async listObjects(
    bucket: string,
    prefix: string,
  ): Promise<Array<{ name: string; size: number }>> {
    const objects: Array<{ name: string; size: number }> = [];
    const fullPrefix = `${bucket}/${prefix}/`;
    for (const [key, buf] of this.objects) {
      if (!key.startsWith(fullPrefix)) continue;
      const rest = key.slice(fullPrefix.length);
      if (rest.includes("/")) continue;
      objects.push({ name: rest, size: buf.length });
    }
    return objects;
  }
}

// ---------------------------------------------------------------------------
// Data + transaction functions
// ---------------------------------------------------------------------------

interface FakeListingStored extends StudioListingRow, Record<string, unknown> {}

export class FakeData implements StudioData {
  members: StudioMembershipRow[] = [];
  jobs = new Map<string, StudioJobRow & { processing_started_at: number | null }>();
  objectOwners = new Map<string, string | null>();
  listings: FakeListingStored[] = [];
  contacts = new Map<string, StudioPrivateContact>();
  listingWarnings: Array<{ listingId: string; warning: ProgressiveWarning }> = [];
  audits: StudioAuditEntry[] = [];
  authUsers: Array<{ id: string; email: string }> = [];
  /** Force studio_publish_project to fail AFTER the graph write (rollback test). */
  failAfterIngest = false;
  /** Force the atomic resale edit to fail after every provisional write. */
  failAfterResaleEdit = false;
  private sequence = 0;

  constructor(
    private executor: FakeIngestExecutor,
    private clock: () => number,
  ) {}

  async getMembership(userId: string) {
    return this.members.find((row) => row.user_id === userId) ?? null;
  }
  async listMembers() {
    return this.members.map((m) => ({ ...m }));
  }
  async upsertMembership(row: StudioMembershipRow) {
    const index = this.members.findIndex((member) => member.user_id === row.user_id);
    if (index >= 0) this.members[index] = { ...row };
    else this.members.push({ ...row });
  }
  async countActiveOwners() {
    return this.members.filter((row) => row.role === "owner" && row.is_active).length;
  }
  async bootstrapOwner(userId: string, email: string) {
    if (this.members.length > 0) return null;
    const row: StudioMembershipRow = {
      user_id: userId,
      role: "owner",
      display_name: null,
      email,
      invited_by: null,
      is_active: true,
    };
    this.members.push({ ...row });
    return row;
  }

  private currentRole(userId: string | null): "owner" | "trusted_publisher" {
    const member = this.members.find((row) => row.user_id === userId && row.is_active);
    if (!member) throw new Error("studio_membership_required");
    return member.role;
  }

  private toProjectRow(row: { slug: string } & Record<string, unknown>): StudioProjectRow {
    return {
      id: String(row.id),
      slug: row.slug,
      name: String(row.name ?? ""),
      public_status: String(row.public_status ?? "draft"),
      is_active: Boolean(row.is_active),
      main_image_url: (row.main_image_url as string | null) ?? null,
      brochure_url: (row.brochure_url as string | null) ?? null,
      updated_at: null,
    };
  }

  async findProjectBySlug(slug: string): Promise<StudioProjectRow | null> {
    const row = this.executor.store.projects.find((project) => project.slug === slug);
    return row ? this.toProjectRow(row) : null;
  }
  async listProjects(createdBy?: string): Promise<StudioProjectRow[]> {
    return this.executor.store.projects
      .filter(
        (row) => !createdBy || this.objectOwners.get(`project:${String(row.id)}`) === createdBy,
      )
      .slice(0, 200)
      .map((row) => this.toProjectRow(row));
  }
  async getProjectDetail(slug: string): Promise<StudioProjectDetailRow | null> {
    const project = this.executor.store.projects.find((p) => p.slug === slug);
    if (!project) return null;
    const media = this.executor.store.media
      .filter((m) => m.project_id === project.id)
      .map((m) => ({
        url: m.url,
        media_type: m.media_type,
        title: m.title,
        sort_order: m.sort_order,
      }));
    return { project: { ...this.toProjectRow(project), ...project }, media };
  }
  async getObjectCreatedBy(objectType: "project" | "listing", objectId: string) {
    return this.objectOwners.get(`${objectType}:${objectId}`) ?? null;
  }

  async getListing(id: string) {
    return this.listings.find((row) => row.id === id) ?? null;
  }
  async findListingBySlug(slug: string) {
    return this.listings.find((row) => row.slug === slug) ?? null;
  }
  async getListingDetail(id: string): Promise<StudioListingDetailRow | null> {
    const row = this.listings.find((r) => r.id === id);
    if (!row) return null;
    const contact = this.contacts.get(id) ?? {
      contact_name: null,
      contact_phone: null,
      contact_email: null,
    };
    return { ...row, contact };
  }
  async updateListing(id: string, patch: Record<string, unknown>) {
    const index = this.listings.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`listing not found: ${id}`);
    this.listings[index] = { ...this.listings[index], ...patch, id };
  }
  async listListings(createdBy?: string) {
    return this.listings
      .filter((row) => !createdBy || this.objectOwners.get(`listing:${row.id}`) === createdBy)
      .slice(0, 200)
      .map((row) => ({ ...row }));
  }

  async createJob(row: StudioJobRow) {
    this.jobs.set(row.id, { ...structuredClone(row), processing_started_at: null });
  }
  async getJob(id: string) {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : null;
  }
  async updateJobIfClaimed(id: string, token: string, patch: Partial<StudioJobRow>) {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status !== "processing" || job.processing_token !== token) return false;
    this.jobs.set(id, { ...job, ...structuredClone(patch) });
    return true;
  }
  async listJobs(limit: number, createdBy?: string) {
    return [...this.jobs.values()]
      .filter((job) => !createdBy || job.created_by === createdBy)
      .slice(-limit)
      .reverse()
      .map((j) => structuredClone(j));
  }
  async countActiveJobs(createdBy?: string) {
    const activeSources = new Set(
      this.members.filter((member) => member.is_active).map((member) => member.user_id),
    );
    return [...this.jobs.values()].filter(
      (job) =>
        job.created_by !== null &&
        activeSources.has(job.created_by) &&
        (!createdBy || job.created_by === createdBy) &&
        job.processing_requested_at !== null &&
        (job.status === "received" ||
          job.status === "processing" ||
          (job.status === "failed" && job.retryable)),
    ).length;
  }
  async listDueJobs(staleSeconds: number, limit: number, createdBy?: string) {
    const staleBefore = this.clock() - staleSeconds * 1000;
    const activeSources = new Set(
      this.members.filter((member) => member.is_active).map((member) => member.user_id),
    );
    return [...this.jobs.values()]
      .filter(
        (job) =>
          job.created_by !== null &&
          activeSources.has(job.created_by) &&
          job.processing_requested_at !== null &&
          (!createdBy || job.created_by === createdBy) &&
          (job.status === "received" ||
            (job.status === "failed" && job.retryable) ||
            (job.status === "processing" &&
              (job.processing_started_at == null || job.processing_started_at < staleBefore))),
      )
      .sort(
        (left, right) =>
          left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
      )
      .slice(0, limit)
      .map((j) => structuredClone(j));
  }

  async claimJob(jobId: string, token: string, staleSeconds: number): Promise<StudioJobRow | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    // Mirrors studio_claim_job: current active membership authorizes the claim;
    // the immutable job.creator_role snapshot is never consulted here.
    this.currentRole(job.created_by);
    const staleBefore = this.clock() - staleSeconds * 1000;
    // Mirrors studio_claim_job: received | retryable-failed | stale-processing.
    // A published job and a terminal (retryable=false) failure are NEVER
    // reclaimed.
    const claimable =
      job.processing_requested_at !== null &&
      job.status !== "published" &&
      (job.status === "received" ||
        (job.status === "failed" && job.retryable) ||
        (job.status === "processing" &&
          (job.processing_started_at == null || job.processing_started_at < staleBefore)));
    if (!claimable) return null;
    job.status = "processing";
    job.processing_token = token;
    job.processing_started_at = this.clock();
    job.attempt_count += 1;
    job.error = null;
    job.error_code = null;
    return structuredClone(job);
  }

  async requestJobProcessing(
    jobId: string,
    token: string,
    staleSeconds: number,
  ): Promise<StudioJobRow | null> {
    const job = this.jobs.get(jobId);
    if (!job || job.status === "published") return null;
    // The production RPC performs readiness + claim in one transaction. Check
    // authorization before changing the in-memory row so a rejected request
    // mirrors that transaction's complete rollback.
    this.currentRole(job.created_by);
    job.processing_requested_at ??= new Date(this.clock()).toISOString();
    return this.claimJob(jobId, token, staleSeconds);
  }

  async heartbeatJob(jobId: string, token: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status !== "processing" || job.processing_token !== token) return false;
    job.processing_started_at = this.clock();
    return true;
  }

  async failJob(input: {
    jobId: string;
    token: string;
    errorCode: string;
    message: string;
    retryable: boolean;
  }) {
    const job = this.jobs.get(input.jobId);
    if (!job) return;
    if (job.status !== "processing" || job.processing_token !== input.token) return;
    job.status = "failed";
    job.processing_token = null;
    job.error_code = input.errorCode;
    job.error = input.message.slice(0, 500);
    job.retryable = input.retryable;
  }

  async publishProject(input: {
    jobId: string;
    token: string;
    batch: import("@/features/forever-ingestion/batch-types").ProgressiveBatch;
    publish: boolean;
    result: Record<string, unknown>;
  }) {
    const job = this.jobs.get(input.jobId);
    if (!job) throw new Error("studio_job_not_found");
    if (job.status === "published") {
      const stored = (job.result_summary ?? {}) as Record<string, unknown>;
      return {
        schema_version: "1" as const,
        mode: input.batch.mode,
        project_id: String(stored.projectId ?? ""),
        project_slug: job.project_slug ?? "",
        public_status: String(stored.publicStatus ?? "published"),
        counts: (stored.counts as never) ?? {
          buildings: 0,
          units: 0,
          prices: 0,
          media: 0,
          warnings: 0,
        },
        replayed: true,
      };
    }
    if (job.processing_token !== input.token) throw new Error("studio_job_not_claimed");

    const actorRole = this.currentRole(job.created_by);
    const slug = input.batch.project.slug;
    const existingProject = this.executor.store.projects.find((project) => project.slug === slug);
    const existingOwnerKey = existingProject ? `project:${String(existingProject.id)}` : null;
    const hadOwner = existingOwnerKey
      ? this.objectOwners.has(existingOwnerKey) && this.objectOwners.get(existingOwnerKey) != null
      : false;
    const existingOwner = existingOwnerKey ? this.objectOwners.get(existingOwnerKey) : undefined;
    if (
      existingProject &&
      actorRole === "trusted_publisher" &&
      (!hadOwner || existingOwner !== job.created_by)
    ) {
      throw new Error("studio_object_ownership_conflict");
    }

    // Snapshot for atomic rollback (graph + publication + job) on any failure.
    const storeSnapshot = structuredClone(this.executor.store);
    const jobSnapshot = structuredClone(job);
    const ownersSnapshot = new Map(this.objectOwners);
    try {
      const summary = await this.executor.ingest(input.batch);
      if (input.publish) {
        const project = this.executor.store.projects.find((p) => p.id === summary.project_id);
        if (project) {
          project.public_status = "published";
          project.is_active = true;
        }
      }
      const ownerKey = `project:${summary.project_id}`;
      if (!existingProject) {
        if (!this.objectOwners.has(ownerKey)) this.objectOwners.set(ownerKey, job.created_by);
        if (this.objectOwners.get(ownerKey) !== job.created_by) {
          throw new Error("studio_object_ownership_conflict");
        }
      } else if (actorRole === "owner" && !hadOwner) {
        this.objectOwners.set(ownerKey, job.created_by);
      }
      if (this.failAfterIngest) throw new Error("studio_publish_project injected failure");
      const publicStatus = input.publish ? "published" : summary.public_status;
      job.status = "published";
      job.processing_token = null;
      job.project_slug = summary.project_slug;
      job.content_fingerprint = input.batch.batch_fingerprint;
      job.result_summary = {
        ...input.result,
        projectId: summary.project_id,
        publicStatus,
        counts: summary.counts,
      };
      job.error = null;
      job.error_code = null;
      return { ...summary, public_status: publicStatus, replayed: false };
    } catch (error) {
      this.executor.store = storeSnapshot;
      this.jobs.set(input.jobId, jobSnapshot);
      this.objectOwners = ownersSnapshot;
      throw error;
    }
  }

  async publishResale(input: {
    jobId: string;
    token: string;
    listing: import("../server/contracts").StudioListingPublishRow;
    contact: StudioPrivateContact;
    warnings: ProgressiveWarning[];
    result: Record<string, unknown>;
  }) {
    const job = this.jobs.get(input.jobId);
    if (!job) throw new Error("studio_job_not_found");
    if (job.status === "published") {
      return {
        listingId: job.listing_id ?? "",
        slug: job.content_fingerprint ?? "",
        replayed: true,
      };
    }
    if (job.processing_token !== input.token) throw new Error("studio_job_not_claimed");

    const actorRole = this.currentRole(job.created_by);
    const slug = input.listing.slug;
    const existing = this.listings.find((row) => row.slug === slug);
    const existingOwnerKey = existing ? `listing:${existing.id}` : null;
    const hadOwner = existingOwnerKey
      ? this.objectOwners.has(existingOwnerKey) && this.objectOwners.get(existingOwnerKey) != null
      : false;
    const existingOwner = existingOwnerKey ? this.objectOwners.get(existingOwnerKey) : undefined;
    if (
      existing &&
      actorRole === "trusted_publisher" &&
      (!hadOwner || existingOwner !== job.created_by)
    ) {
      throw new Error("studio_object_ownership_conflict");
    }

    const listingsSnapshot = structuredClone(this.listings);
    const contactsSnapshot = new Map(this.contacts);
    const warningsSnapshot = structuredClone(this.listingWarnings);
    const ownersSnapshot = new Map(this.objectOwners);
    const jobSnapshot = structuredClone(job);
    try {
      let listingId: string;
      if (existing) {
        listingId = existing.id;
        Object.assign(existing, this.listingRowFrom(input.listing), {
          publication_status: "published",
        });
        if (actorRole === "owner" && !hadOwner) {
          this.objectOwners.set(`listing:${listingId}`, job.created_by);
        }
      } else {
        this.sequence += 1;
        listingId = `listing-${this.sequence}`;
        this.listings.push({
          ...this.listingRowFrom(input.listing),
          id: listingId,
          publication_status: "published",
          updated_at: null,
        });
        const ownerKey = `listing:${listingId}`;
        if (!this.objectOwners.has(ownerKey)) this.objectOwners.set(ownerKey, job.created_by);
        if (this.objectOwners.get(ownerKey) !== job.created_by) {
          throw new Error("studio_object_ownership_conflict");
        }
      }
      this.contacts.set(listingId, { ...input.contact });
      this.listingWarnings = this.listingWarnings.filter((w) => w.listingId !== listingId);
      for (const warning of input.warnings) this.listingWarnings.push({ listingId, warning });

      job.status = "published";
      job.processing_token = null;
      job.listing_id = listingId;
      job.content_fingerprint = slug;
      job.result_summary = { ...input.result, listingId, slug };
      return { listingId, slug, replayed: false };
    } catch (error) {
      this.listings = listingsSnapshot;
      this.contacts = contactsSnapshot;
      this.listingWarnings = warningsSnapshot;
      this.objectOwners = ownersSnapshot;
      this.jobs.set(input.jobId, jobSnapshot);
      throw error;
    }
  }

  private listingRowFrom(
    listing: import("../server/contracts").StudioListingPublishRow,
  ): FakeListingStored {
    return {
      id: "",
      slug: listing.slug,
      title: listing.title,
      publication_status: "published",
      project_id: listing.project_id,
      project_name_raw: listing.project_name_raw,
      location_id: listing.location_id,
      location_name_raw: listing.location_name_raw,
      property_type: listing.property_type,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      area_sqm: listing.area_sqm,
      price: listing.price,
      currency: listing.currency,
      availability_status: listing.availability_status,
      description: listing.description,
      photos: listing.photos,
      field_provenance: listing.field_provenance as unknown as FieldProvenanceMap,
      updated_at: null,
    } as FakeListingStored;
  }

  async updateResale(input: {
    listingId: string;
    actorId: string;
    fields: Record<string, string | number>;
    contact: Record<string, string>;
    suppliedAt: string;
    injectFailure?: boolean;
  }) {
    const role = this.currentRole(input.actorId);
    const ownerKey = `listing:${input.listingId}`;
    if (
      role === "trusted_publisher" &&
      (!this.objectOwners.has(ownerKey) || this.objectOwners.get(ownerKey) !== input.actorId)
    ) {
      throw new Error("studio_object_ownership_conflict");
    }
    const index = this.listings.findIndex((row) => row.id === input.listingId);
    if (index < 0) throw new Error("listing_not_found");

    const listingSnapshot = structuredClone(this.listings);
    const contactSnapshot = new Map(this.contacts);
    const warningsSnapshot = structuredClone(this.listingWarnings);
    const ownersSnapshot = new Map(this.objectOwners);
    try {
      if (role === "owner" && this.objectOwners.get(ownerKey) == null) {
        this.objectOwners.set(ownerKey, input.actorId);
      }
      const listing = this.listings[index];
      const provenance = {
        ...((listing.field_provenance as FieldProvenanceMap | undefined) ?? {}),
      };
      const incomingStatus = role === "owner" ? "owner_provided" : "trusted_publisher_provided";
      const conflicts: ProgressiveWarning[] = [];
      const appliedFields: string[] = [];
      const mappings: Array<[string, string]> = [
        ["title", "title"],
        ["projectName", "project_name_raw"],
        ["locationText", "location_name_raw"],
        ["propertyType", "property_type"],
        ["bedrooms", "bedrooms"],
        ["bathrooms", "bathrooms"],
        ["areaSqm", "area_sqm"],
        ["price", "price"],
        ["currency", "currency"],
        ["description", "description"],
      ];
      for (const [factKey, column] of mappings) {
        if (!(factKey in input.fields)) continue;
        const incoming: FieldProvenance = {
          status: incomingStatus,
          supplied_at: input.suppliedAt,
          note: "studio_manual_entry",
        };
        const current = listing[column];
        if (
          canReplaceField(provenance[factKey], incoming, current == null || current === "") ===
          "apply"
        ) {
          listing[column] = input.fields[factKey];
          provenance[factKey] = incoming;
          appliedFields.push(column);
        } else {
          const warning: ProgressiveWarning = {
            entity: "listing",
            field: column,
            code: "listing_field_conflict_preserved",
            severity: "warning",
            message: `${column}: the current value was set by a stronger source (${provenance[factKey]?.status ?? "unknown"}) and was preserved; the attempted change by ${role} was recorded, not applied.`,
            payload: { attempted_by: role, attempted_status: incomingStatus },
          };
          conflicts.push(warning);
          const duplicate = this.listingWarnings.some(
            (row) =>
              row.listingId === input.listingId &&
              row.warning.code === warning.code &&
              row.warning.field === warning.field &&
              row.warning.message === warning.message &&
              JSON.stringify(row.warning.payload ?? {}) === JSON.stringify(warning.payload ?? {}),
          );
          if (!duplicate) this.listingWarnings.push({ listingId: input.listingId, warning });
        }
      }
      if (appliedFields.length) listing.field_provenance = provenance;

      if (Object.keys(input.contact).length) {
        const current = this.contacts.get(input.listingId) ?? {
          contact_name: null,
          contact_phone: null,
          contact_email: null,
        };
        this.contacts.set(input.listingId, { ...current, ...input.contact });
      }

      if (input.injectFailure || this.failAfterResaleEdit) {
        throw new Error("studio_resale_edit_injected_failure");
      }
      return { warnings: conflicts, appliedFields };
    } catch (error) {
      this.listings = listingSnapshot;
      this.contacts = contactSnapshot;
      this.listingWarnings = warningsSnapshot;
      this.objectOwners = ownersSnapshot;
      throw error;
    }
  }

  // --- Large-archive durable inventory (mirrors the migration's RPCs) ------

  archives = new Map<string, StudioArchiveRow>();
  archiveEntries = new Map<string, StudioArchiveEntryRow>();

  /** Mirrors the SQL claim check every archive-processing RPC performs. */
  private jobClaimHeld(jobId: string, token: string): boolean {
    const job = this.jobs.get(jobId);
    return !!job && job.status === "processing" && job.processing_token === token;
  }

  /**
   * Mirrors the manifest identity preimage the server derives at plan time
   * (deriveManifestSha256) and the SQL trigger recomputes on every row
   * version: sha256 over the domain prefix, the 8-byte BE declared size, the
   * 4-byte BE part size and part count, and the ordered raw declared digests.
   */
  private archiveManifestSha256(row: StudioArchiveRow): string {
    const hash = createHash("sha256");
    hash.update(Buffer.from(UPLOAD_MANIFEST_DOMAIN, "utf8"));
    const geometry = Buffer.alloc(16);
    geometry.writeBigUInt64BE(BigInt(row.declared_size), 0);
    geometry.writeUInt32BE(row.part_size, 8);
    geometry.writeUInt32BE(row.part_count, 12);
    hash.update(geometry);
    for (const part of row.parts) hash.update(Buffer.from(part.declaredSha256 ?? "", "hex"));
    return hash.digest("hex");
  }

  /**
   * Mirrors the trigger's manifest-binding + per-state evidence section,
   * which runs on EVERY row version (insert, transition, same-state): the
   * parts array must always be the plan-bound declared manifest —
   * cryptographically bound to the immutable manifest identity — and any row
   * in byte_verified/processing_entries/completed must carry the complete
   * byte-verification and inventory evidence.
   */
  private assertArchiveState(next: StudioArchiveRow, isInsert: boolean): void {
    const HEX64 = /^[0-9a-f]{64}$/;
    const verifiedState = ["byte_verified", "processing_entries", "completed"].includes(
      next.status,
    );
    if (!Array.isArray(next.parts)) {
      throw new Error("studio_archive_manifest_binding_violation: parts_not_array");
    }
    if (next.parts.length !== next.part_count) {
      throw new Error("studio_archive_manifest_binding_violation: part_count");
    }
    if (next.part_count !== Math.ceil(next.declared_size / next.part_size)) {
      throw new Error("studio_archive_manifest_binding_violation: geometry");
    }
    let sizeSum = 0;
    let sizesMissing = false;
    next.parts.forEach((part, position) => {
      if (typeof part !== "object" || part === null || Array.isArray(part)) {
        throw new Error("studio_archive_manifest_binding_violation: part_shape");
      }
      for (const key of Object.keys(part)) {
        if (!["index", "size", "declaredSha256", "sha256", "verified"].includes(key)) {
          throw new Error(`studio_archive_manifest_binding_violation: part_field ${key}`);
        }
      }
      if (!Number.isInteger(part.index) || part.index !== position) {
        throw new Error("studio_archive_manifest_binding_violation: part_index");
      }
      if (typeof part.declaredSha256 !== "string" || !HEX64.test(part.declaredSha256)) {
        throw new Error("studio_archive_manifest_binding_violation: declared_sha256");
      }
      const expectedSize =
        position < next.part_count - 1
          ? next.part_size
          : next.declared_size - next.part_size * (next.part_count - 1);
      if (part.size != null) {
        if (!Number.isInteger(part.size) || part.size !== expectedSize) {
          throw new Error("studio_archive_manifest_binding_violation: part_size");
        }
        sizeSum += part.size;
      } else {
        sizesMissing = true;
      }
      if (part.sha256 != null && (typeof part.sha256 !== "string" || !HEX64.test(part.sha256))) {
        throw new Error("studio_archive_manifest_binding_violation: server_sha256");
      }
      if (typeof part.verified !== "boolean") {
        throw new Error("studio_archive_manifest_binding_violation: verified_flag");
      }
      if (part.verified && part.sha256 == null) {
        throw new Error("studio_archive_manifest_binding_violation: verified_without_hash");
      }
      if (isInsert && (part.sha256 != null || part.verified)) {
        throw new Error("studio_archive_planned_carries_evidence");
      }
      if (verifiedState) {
        if (!part.verified || !HEX64.test(part.sha256 ?? "") || part.size == null) {
          throw new Error("studio_archive_byte_verification_evidence_missing: part");
        }
        if (part.sha256 !== part.declaredSha256) {
          throw new Error("studio_archive_byte_verification_evidence_missing: part");
        }
      }
    });
    if (
      HEX64.test(next.manifest_sha256 ?? "") &&
      this.archiveManifestSha256(next) !== next.manifest_sha256
    ) {
      throw new Error("studio_archive_manifest_binding_violation: identity_digest");
    }
    if (next.observed_size != null && next.observed_size !== next.declared_size) {
      throw new Error("studio_archive_manifest_binding_violation: observed_size");
    }
    if (verifiedState) {
      if (sizesMissing || sizeSum !== next.declared_size) {
        throw new Error("studio_archive_byte_verification_evidence_missing: part_sizes");
      }
      if (next.observed_size == null) {
        throw new Error("studio_archive_byte_verification_evidence_missing: observed_size");
      }
      if (!HEX64.test(next.archive_sha256 ?? "")) {
        throw new Error("studio_archive_byte_verification_evidence_missing: archive_sha256");
      }
      const composite = createHash("sha256")
        .update(Buffer.from(next.parts.map((part) => part.sha256).join(""), "utf8"))
        .digest("hex");
      if (next.composite_sha256 !== composite) {
        throw new Error("studio_archive_byte_verification_evidence_missing: composite_sha256");
      }
    }
    if (next.status === "processing_entries" || next.status === "completed") {
      if (
        next.entry_count == null ||
        next.entry_count < 0 ||
        next.total_uncompressed == null ||
        next.total_uncompressed < 0
      ) {
        throw new Error("studio_archive_inventory_evidence_missing");
      }
      const rows = [...this.archiveEntries.values()].filter((row) => row.archive_id === next.id);
      if (rows.length !== next.entry_count) {
        throw new Error("studio_archive_inventory_incomplete");
      }
      if (rows.some((row) => row.job_id !== next.job_id)) {
        throw new Error("studio_archive_inventory_foreign_rows");
      }
    }
    if (next.status === "completed") {
      const pending = [...this.archiveEntries.values()].some(
        (row) => row.archive_id === next.id && row.state === "pending",
      );
      if (pending) throw new Error("studio_archive_completed_with_pending_entries");
    }
  }

  /**
   * Mirrors public.studio_archive_lifecycle_guard for UPDATEs: identity
   * immutability, the DB-enforced status transition matrix, post-verification
   * evidence immutability, terminal strict no-ops — and, with NO same-state
   * bypass, the complete landing-state validation of assertArchiveState.
   * Violations throw exactly like the trigger raises, leaving the stored row
   * unchanged.
   */
  private assertArchiveLifecycle(previous: StudioArchiveRow, next: StudioArchiveRow): void {
    if (
      next.id !== previous.id ||
      next.job_id !== previous.job_id ||
      next.manifest_sha256 !== previous.manifest_sha256 ||
      next.declared_size !== previous.declared_size ||
      next.part_size !== previous.part_size ||
      next.part_count !== previous.part_count ||
      next.ordinal !== previous.ordinal ||
      next.file_name !== previous.file_name ||
      next.created_at !== previous.created_at
    ) {
      throw new Error("studio_archive_identity_immutable");
    }
    const allowed: Record<StudioArchiveStatus, StudioArchiveStatus[]> = {
      planned: ["uploaded_unverified", "rejected"],
      uploaded_unverified: ["byte_verifying", "rejected"],
      byte_verifying: ["byte_verified", "rejected"],
      byte_verified: ["processing_entries", "rejected"],
      processing_entries: ["completed", "rejected"],
      completed: [],
      rejected: [],
    };
    if (next.status !== previous.status && !allowed[previous.status]?.includes(next.status)) {
      throw new Error(`studio_archive_invalid_transition: ${previous.status} -> ${next.status}`);
    }
    const changed = (left: unknown, right: unknown) =>
      JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);
    // Terminal states accept only a strict no-op re-write.
    if (previous.status === "completed" || previous.status === "rejected") {
      if (
        changed(next.parts, previous.parts) ||
        changed(next.observed_size, previous.observed_size) ||
        changed(next.composite_sha256, previous.composite_sha256) ||
        changed(next.archive_sha256, previous.archive_sha256) ||
        changed(next.entry_count, previous.entry_count) ||
        changed(next.total_uncompressed, previous.total_uncompressed) ||
        changed(next.extracted, previous.extracted) ||
        changed(next.error_code, previous.error_code)
      ) {
        throw new Error(`studio_archive_terminal_immutable: ${previous.status}`);
      }
    }
    // Once byte-verified, the verification evidence is frozen in every later
    // state — same-state updates included.
    if (["byte_verified", "processing_entries", "completed"].includes(previous.status)) {
      if (changed(next.parts, previous.parts)) {
        throw new Error("studio_archive_verified_evidence_immutable: parts");
      }
      if (changed(next.observed_size, previous.observed_size)) {
        throw new Error("studio_archive_verified_evidence_immutable: observed_size");
      }
      if (changed(next.composite_sha256, previous.composite_sha256)) {
        throw new Error("studio_archive_verified_evidence_immutable: composite_sha256");
      }
      if (changed(next.archive_sha256, previous.archive_sha256)) {
        throw new Error("studio_archive_verified_evidence_immutable: archive_sha256");
      }
    }
    if (["processing_entries", "completed"].includes(previous.status)) {
      if (
        changed(next.entry_count, previous.entry_count) ||
        changed(next.total_uncompressed, previous.total_uncompressed)
      ) {
        throw new Error("studio_archive_verified_evidence_immutable: inventory");
      }
    }
    this.assertArchiveState(next, false);
  }

  async createArchive(row: StudioArchiveRow) {
    // Mirrors the trigger's INSERT rules: every archive starts at 'planned',
    // carries its plan-bound declared manifest, and NO verification evidence.
    if (row.status !== "planned") {
      throw new Error(`studio_archive_invalid_initial_status: ${row.status}`);
    }
    if (
      row.observed_size != null ||
      row.composite_sha256 != null ||
      row.archive_sha256 != null ||
      row.entry_count != null ||
      row.total_uncompressed != null
    ) {
      throw new Error("studio_archive_planned_carries_evidence");
    }
    this.assertArchiveState(row, true);
    this.archives.set(row.id, structuredClone(row));
  }
  async getArchive(id: string) {
    const row = this.archives.get(id);
    return row ? structuredClone(row) : null;
  }
  async listJobArchives(jobId: string) {
    return [...this.archives.values()]
      .filter((row) => row.job_id === jobId)
      .sort(
        (left, right) =>
          left.ordinal - right.ordinal ||
          left.created_at.localeCompare(right.created_at) ||
          left.id.localeCompare(right.id),
      )
      .map((row) => structuredClone(row));
  }
  async updateArchivePreProcessing(
    id: string,
    fromStatuses: StudioArchiveStatus[],
    patch: Partial<StudioArchiveRow>,
  ) {
    const row = this.archives.get(id);
    if (!row || !fromStatuses.includes(row.status)) return false;
    const next = { ...row, ...structuredClone(patch) };
    // The production write is a direct table UPDATE — the lifecycle trigger
    // still fires there, so the fake enforces the identical matrix.
    this.assertArchiveLifecycle(row, next);
    this.archives.set(id, next);
    return true;
  }
  async updateArchiveIfClaimed(
    jobId: string,
    token: string,
    archiveId: string,
    patch: Partial<StudioArchiveRow>,
  ) {
    // Mirrors the RPC's explicit patch whitelist: unknown fields raise, never
    // silently apply or drop.
    const record = patch as Record<string, unknown>;
    const keys = Object.keys(patch).filter((key) => record[key] !== undefined);
    const whitelist = [
      "status",
      "parts",
      "observed_size",
      "composite_sha256",
      "archive_sha256",
      "entry_count",
      "total_uncompressed",
      "extracted",
      "error_code",
    ];
    if (keys.some((key) => !whitelist.includes(key))) {
      throw new Error("studio_archive_patch_invalid: unknown_field");
    }
    if (!this.jobClaimHeld(jobId, token)) return false;
    // Mirrors the RPC's locked ownership proof: the target archive must
    // exist AND belong to the claimed job, else FALSE (never a write).
    const row = this.archives.get(archiveId);
    if (!row || row.job_id !== jobId) return false;
    // Mirrors the RPC's post-verification whitelist reduction: evidence
    // fields cannot even be presented once the archive passed verification.
    if (
      ["byte_verified", "processing_entries", "completed", "rejected"].includes(row.status) &&
      keys.some((key) =>
        ["parts", "observed_size", "composite_sha256", "archive_sha256"].includes(key),
      )
    ) {
      throw new Error("studio_archive_patch_forbidden: verified_evidence");
    }
    if (
      ["processing_entries", "completed", "rejected"].includes(row.status) &&
      keys.some((key) => ["entry_count", "total_uncompressed"].includes(key))
    ) {
      throw new Error("studio_archive_patch_forbidden: inventory");
    }
    if (
      ["completed", "rejected"].includes(row.status) &&
      keys.some((key) => ["extracted", "error_code"].includes(key))
    ) {
      throw new Error("studio_archive_patch_forbidden: terminal");
    }
    const next = { ...row } as StudioArchiveRow;
    for (const key of keys) {
      (next as unknown as Record<string, unknown>)[key] = structuredClone(record[key]);
    }
    this.assertArchiveLifecycle(row, next);
    this.archives.set(archiveId, next);
    return true;
  }
  async insertArchiveEntriesIfClaimed(
    jobId: string,
    token: string,
    entries: StudioArchiveEntryRow[],
  ) {
    if (!this.jobClaimHeld(jobId, token)) return false;
    // Mirrors the RPC's locked ownership proof on the target archive.
    const targetArchive = entries[0] ? this.archives.get(entries[0].archive_id) : undefined;
    if (entries.length > 0 && (!targetArchive || targetArchive.job_id !== jobId)) return false;
    // Mirrors the RPC's phase gate: inventory rows may only be recorded while
    // the archive is byte_verified — never diluted into a later state.
    if (entries.length > 0 && targetArchive && targetArchive.status !== "byte_verified") {
      throw new Error(`studio_archive_entries_invalid: archive_state ${targetArchive.status}`);
    }
    for (const entry of entries) {
      // Mirrors the entry guard trigger (backed by the composite FK): an
      // entry can never claim an archive under a different job.
      const parent = this.archives.get(entry.archive_id);
      if (!parent) throw new Error("studio_archive_entry_parent_missing");
      if (parent.job_id !== entry.job_id) {
        throw new Error("studio_archive_entry_cross_job");
      }
      // Mirrors the trigger's INSERT shape: a new inventory row records
      // identity only — pending, with NO outcome/settlement data.
      if (entry.state !== "pending") {
        throw new Error(`studio_archive_entry_insert_not_pending: ${entry.state}`);
      }
      if (
        entry.outcome_code != null ||
        entry.observed_size != null ||
        entry.sha256 != null ||
        entry.media_class != null ||
        entry.public_bucket != null ||
        entry.public_path != null ||
        entry.public_url != null ||
        entry.media_type != null ||
        entry.media_title != null ||
        entry.media_truth != null ||
        entry.evidence != null ||
        entry.attempt != null ||
        entry.processed_at != null
      ) {
        throw new Error("studio_archive_entry_insert_carries_outcome");
      }
      if (parent.entry_count != null && entry.entry_index >= parent.entry_count) {
        throw new Error(`studio_archive_entry_index_out_of_range: ${entry.entry_index}`);
      }
      const duplicate = [...this.archiveEntries.values()].some(
        (row) => row.archive_id === entry.archive_id && row.entry_index === entry.entry_index,
      );
      if (duplicate) continue;
      this.archiveEntries.set(entry.id, structuredClone(entry));
    }
    return true;
  }
  async listArchiveEntries(archiveId: string, states?: StudioArchiveEntryState[]) {
    return [...this.archiveEntries.values()]
      .filter((row) => row.archive_id === archiveId && (!states || states.includes(row.state)))
      .sort((left, right) => left.entry_index - right.entry_index)
      .map((row) => structuredClone(row));
  }
  async listJobArchiveEntries(jobId: string, states?: StudioArchiveEntryState[]) {
    return [...this.archiveEntries.values()]
      .filter((row) => row.job_id === jobId && (!states || states.includes(row.state)))
      .sort((left, right) => left.entry_index - right.entry_index)
      .map((row) => structuredClone(row));
  }
  async settleArchiveEntryIfClaimed(
    jobId: string,
    token: string,
    entryId: string,
    outcome: StudioArchiveEntryOutcome,
  ) {
    if (!this.jobClaimHeld(jobId, token)) return false;
    const entry = this.archiveEntries.get(entryId);
    if (!entry || entry.job_id !== jobId || entry.state !== "pending") return false;
    // Mirrors the RPC's archive-ownership proof: the entry's parent archive
    // must belong to the claimed job AND still be in its processing phase.
    const parent = this.archives.get(entry.archive_id);
    if (!parent || parent.job_id !== jobId) return false;
    if (parent.status !== "processing_entries") return false;
    // Mirrors the entry guard's settlement-consistency rules: the transition
    // is complete (processed_at), only a published entry references a public
    // object (completely), and published entries carry no private evidence.
    if (!outcome.processedAt) {
      throw new Error("studio_archive_entry_settlement_incomplete: processed_at");
    }
    if (outcome.state === "published_public") {
      if (!outcome.publicBucket || !outcome.publicPath || !outcome.publicUrl) {
        throw new Error("studio_archive_entry_settlement_incomplete: public_object");
      }
      if (outcome.evidence != null) {
        throw new Error("studio_archive_entry_settlement_inconsistent: evidence");
      }
    } else if (
      outcome.publicBucket != null ||
      outcome.publicPath != null ||
      outcome.publicUrl != null
    ) {
      throw new Error("studio_archive_entry_settlement_inconsistent: public_object");
    }
    Object.assign(entry, {
      state: outcome.state,
      outcome_code: outcome.outcomeCode,
      observed_size: outcome.observedSize ?? null,
      sha256: outcome.sha256 ?? null,
      media_class: outcome.mediaClass ?? null,
      public_bucket: outcome.publicBucket ?? null,
      public_path: outcome.publicPath ?? null,
      public_url: outcome.publicUrl ?? null,
      media_type: outcome.mediaType ?? null,
      media_title: outcome.mediaTitle ?? null,
      media_truth: outcome.mediaTruth ? structuredClone(outcome.mediaTruth) : null,
      evidence: outcome.evidence ? structuredClone(outcome.evidence) : null,
      attempt: outcome.attempt,
      processed_at: outcome.processedAt,
    });
    return true;
  }
  async releaseJobIfClaimed(jobId: string, token: string) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "processing" || job.processing_token !== token) return false;
    job.status = "received";
    job.processing_token = null;
    return true;
  }

  /** Set to make recordAudit throw (audit-failure regression). */
  failAudit = false;

  async recordAudit(entry: StudioAuditEntry) {
    if (this.failAudit) {
      throw new Error(
        "audit_log insert failed: injected outage at /var/db postgres://user:pw@db:5432/app",
      );
    }
    this.audits.push(entry);
  }

  publicListings(): FakeListingStored[] {
    return this.listings.filter((row) => row.publication_status === "published");
  }
}

// ---------------------------------------------------------------------------
// existing-state mirror
// ---------------------------------------------------------------------------

export function fakeFetchExisting(executor: FakeIngestExecutor) {
  return async (slug: string): Promise<ExistingProjectState | undefined> => {
    const project = executor.store.projects.find((row) => row.slug === slug);
    if (!project) return undefined;
    const provenanceOf = (metadata: Record<string, unknown> | undefined): FieldProvenanceMap =>
      (metadata?.field_provenance as FieldProvenanceMap | undefined) ?? {};
    const state: ExistingProjectState = {
      project: {
        values: project,
        fieldProvenance: (project.field_provenance as FieldProvenanceMap) ?? {},
      },
      buildings: {},
      units: {},
      prices: {},
      media: {},
    };
    for (const building of executor.store.buildings.filter(
      (row) => row.project_id === project.id,
    )) {
      state.buildings![building.building_code] = {
        values: building as unknown as Record<string, unknown>,
        fieldProvenance: provenanceOf(building.metadata),
      };
    }
    const unitCodeById = new Map<string, string>();
    for (const unit of executor.store.units.filter((row) => row.project_id === project.id)) {
      unitCodeById.set(unit.id, unit.unit_code);
      state.units![unit.unit_code] = {
        values: unit as unknown as Record<string, unknown>,
        fieldProvenance: provenanceOf(unit.metadata),
      };
    }
    for (const price of executor.store.prices) {
      const unitCode = unitCodeById.get(price.unit_id);
      if (!unitCode) continue;
      const key = priceStateKey({
        unit_code: unitCode,
        price_source: price.price_source ?? undefined,
        source_file: price.source_file ?? undefined,
        source_page: price.source_page ?? undefined,
        price_list_date: price.price_list_date ?? undefined,
      });
      state.prices![key] = {
        values: price as unknown as Record<string, unknown>,
        fieldProvenance: provenanceOf(price.metadata),
      };
    }
    for (const media of executor.store.media.filter((row) => row.project_id === project.id)) {
      state.media![mediaStateKey({ media_type: media.media_type, url: media.url })] = {
        values: media as unknown as Record<string, unknown>,
        fieldProvenance: provenanceOf(media.metadata),
      };
    }
    return state;
  };
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export interface FakeWorld {
  deps: StudioDeps;
  executor: FakeIngestExecutor;
  storage: FakeStorage;
  data: FakeData;
  flags: {
    partnerDemo: boolean;
    ownerBootstrapEmail: string | null;
    ownerBootstrapUserId: string | null;
    nowValue: string;
    nowMs: number;
    tokenSeq: number;
  };
  advanceMinutes(mins: number): void;
  pdfExtractions: Map<string, PriceListPdfExtraction>;
  archives: Map<string, Array<{ name: string; data: Buffer }>>;
  /** Archive names the fake ZIP validator rejects (full-contract failure). */
  archiveRejects: Set<string>;
  developers: DependencyCandidate[];
  locations: DependencyCandidate[];
}

export function makeWorld(options: { defaultMembers?: boolean } = {}): FakeWorld {
  const executor = new FakeIngestExecutor();
  const storage = new FakeStorage();
  const flags = {
    partnerDemo: false,
    ownerBootstrapEmail: null as string | null,
    ownerBootstrapUserId: null as string | null,
    nowValue: "2026-07-21T09:00:00.000Z",
    nowMs: Date.parse("2026-07-21T09:00:00.000Z"),
    tokenSeq: 0,
  };
  const clock = () => flags.nowMs;
  const data = new FakeData(executor, clock);
  if (options.defaultMembers !== false) {
    data.members.push(
      {
        user_id: OWNER.userId,
        role: OWNER.role,
        display_name: OWNER.displayName,
        email: OWNER.email,
        invited_by: null,
        is_active: true,
      },
      {
        user_id: PUBLISHER.userId,
        role: PUBLISHER.role,
        display_name: PUBLISHER.displayName,
        email: PUBLISHER.email,
        invited_by: OWNER.userId,
        is_active: true,
      },
    );
  }
  const pdfExtractions = new Map<string, PriceListPdfExtraction>();
  const archives = new Map<string, Array<{ name: string; data: Buffer }>>();
  const archiveRejects = new Set<string>();
  const developers: DependencyCandidate[] = [];
  const locations: DependencyCandidate[] = [];

  const reader: DependencyReader = {
    findDevelopers: async (q) =>
      developers.filter((row) => row.slug === q.slug || row.name === q.name),
    findLocations: async (q) =>
      locations.filter((row) => row.slug === q.slug || row.name === q.name),
  };

  let authSequence = 0;
  const deps: StudioDeps = {
    data,
    storage,
    ingest: executor,
    authAdmin: {
      async createUser(email) {
        authSequence += 1;
        const user = { id: `auth-${authSequence}`, email };
        data.authUsers.push(user);
        return { id: user.id };
      },
      async findUserIdByEmail(email) {
        return (
          data.authUsers.find((user) => user.email.toLowerCase() === email.toLowerCase())?.id ??
          null
        );
      },
    },
    reader,
    fetchExisting: fakeFetchExisting(executor),
    extractPriceListPdf: async ({ fileName }) =>
      pdfExtractions.get(fileName) ?? {
        priceList: null,
        warnings: [
          {
            entity: "price",
            code: "price_list_extraction_unavailable",
            severity: "warning",
            message: `${fileName} retained (no pdf tool in tests).`,
          },
        ],
      },
    extractArchive: async ({ fileName }, onEntry) => {
      if (archiveRejects.has(fileName)) {
        return {
          expanded: false,
          warnings: [
            {
              entity: "document",
              code: "archive_rejected_unsafe",
              severity: "warning",
              message: `${fileName} was rejected by archive safety checks (injected); retained privately.`,
              payload: { file: fileName },
            },
          ],
        };
      }
      for (const entry of archives.get(fileName) ?? []) await onEntry(entry);
      return { expanded: true, warnings: [] };
    },
    now: () => flags.nowValue,
    newToken: () => {
      flags.tokenSeq += 1;
      return `token-${flags.tokenSeq}`;
    },
    partnerDemoActive: () => flags.partnerDemo,
    ownerBootstrapEmail: () => flags.ownerBootstrapEmail,
    ownerBootstrapUserId: () => flags.ownerBootstrapUserId,
  };

  return {
    deps,
    executor,
    storage,
    data,
    flags,
    advanceMinutes(mins: number) {
      flags.nowMs += mins * 60 * 1000;
      flags.nowValue = new Date(flags.nowMs).toISOString();
    },
    pdfExtractions,
    archives,
    archiveRejects,
    developers,
    locations,
  };
}

export const OWNER: StudioActor = {
  userId: "user-owner",
  email: "owner@example.com",
  role: "owner",
  displayName: "Owner",
};

export const PUBLISHER: StudioActor = {
  userId: "user-publisher",
  email: "publisher@example.com",
  role: "trusted_publisher",
  displayName: "Publisher",
};

export function enroll(world: FakeWorld, actor: StudioActor): void {
  void world.data.upsertMembership({
    user_id: actor.userId,
    role: actor.role,
    display_name: actor.displayName,
    email: actor.email,
    invited_by: null,
    is_active: true,
  });
}

/** Tiny structurally valid synthetic images for magic and sanitizer tests. */
export function tinyJpeg(): Buffer {
  return syntheticJpeg();
}

export function tinyPng(): Buffer {
  return syntheticPng();
}

export function tinyWebp(): Buffer {
  return syntheticWebp();
}

export function tinyPdf(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
}

export function tinyMp4(): Buffer {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
  ]);
}

/** ISO BMFF ftyp with a given 4-char brand (e.g. HEIC "heic", MOV "qt  "). */
export function tinyFtyp(brand: string): Buffer {
  const head = Buffer.from([0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70]);
  const brandBytes = Buffer.from(brand.padEnd(4).slice(0, 4), "latin1");
  return Buffer.concat([head, brandBytes, Buffer.from([0x00, 0x00, 0x00, 0x00]), brandBytes]);
}

/**
 * Valid magic-byte content by extension so media passes byte verification.
 * A per-name suffix keeps distinct files byte-distinct (so legitimate distinct
 * uploads are not treated as duplicates) while the leading magic bytes still
 * classify correctly.
 */
export function magicBytesFor(name: string): Buffer {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const suffix = Buffer.from(`::${name}`);
  const salt = [...name].reduce((sum, char) => (sum + char.charCodeAt(0)) % 256, 0);
  if (["jpg", "jpeg", "bmp", "tif", "tiff"].includes(ext)) return syntheticJpeg(false, 1, salt);
  if (ext === "png" || ext === "gif") return syntheticPng(false, 1, salt);
  if (ext === "webp") return syntheticWebp(false, 1, salt);
  if (ext === "heic") return Buffer.concat([tinyFtyp("heic"), suffix]);
  if (ext === "heif") return Buffer.concat([tinyFtyp("mif1"), suffix]);
  if (ext === "avif") return Buffer.concat([tinyFtyp("avif"), suffix]);
  if (["mp4", "mov", "webm", "mkv", "avi", "m4v"].includes(ext))
    return Buffer.concat([tinyMp4(), suffix]);
  if (ext === "pdf") return Buffer.concat([tinyPdf(), suffix]);
  return Buffer.from(`binary-content-for-${name}`);
}

/** Uploads every declared file of a started job (simulating the browser). */
export function uploadAll(
  world: FakeWorld,
  uploads: Array<{ bucket: string; path: string; name: string }>,
  contents: Record<string, Buffer | string> = {},
): void {
  for (const target of uploads) {
    const body = contents[target.name] ?? magicBytesFor(target.name);
    world.storage.put(target.bucket, target.path, body);
  }
}
