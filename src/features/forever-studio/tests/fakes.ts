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

import type { ProgressiveWarning } from "@/features/forever-ingestion/batch-types";
import type { ExistingProjectState } from "@/features/forever-ingestion/build-batch";
import { mediaStateKey, priceStateKey } from "@/features/forever-ingestion/build-batch";
import type {
  DependencyCandidate,
  DependencyReader,
} from "@/features/forever-ingestion/dependency-resolution";
import type { FieldProvenanceMap } from "@/features/forever-ingestion/provenance";
import { FakeIngestExecutor } from "@/features/forever-ingestion/tests/fake-ingest-executor";

import type {
  PriceListPdfExtraction,
  StudioActor,
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
  signedUploads: string[] = [];
  /** Force copyObject to throw once (models a transient storage failure). */
  failCopyOnce = false;
  /** Force remove to throw once (models a crash before cleanup could run). */
  failRemoveOnce = false;
  /** Every hashObject call, for streaming-verification assertions. */
  hashedPaths: string[] = [];

  private key(bucket: string, path: string): string {
    return `${bucket}/${path}`;
  }

  /** Simulates the browser upload to a signed URL. */
  put(bucket: string, path: string, data: Buffer | string): void {
    this.objects.set(this.key(bucket, path), Buffer.isBuffer(data) ? data : Buffer.from(data));
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

  async copyObject(
    from: { bucket: string; path: string },
    to: { bucket: string; path: string },
  ): Promise<void> {
    if (this.failCopyOnce) {
      this.failCopyOnce = false;
      throw new Error("storage copy failed (injected)");
    }
    const buf = this.objects.get(this.key(from.bucket, from.path));
    if (!buf) throw new Error(`copy source missing: ${from.bucket}/${from.path}`);
    this.objects.set(this.key(to.bucket, to.path), buf);
  }

  async upload(bucket: string, path: string, data: Buffer): Promise<void> {
    this.objects.set(this.key(bucket, path), data);
  }

  async remove(bucket: string, paths: string[]): Promise<void> {
    if (this.failRemoveOnce) {
      this.failRemoveOnce = false;
      throw new Error("storage remove failed (injected)");
    }
    for (const path of paths) this.objects.delete(this.key(bucket, path));
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
  async listProjects(): Promise<StudioProjectRow[]> {
    return this.executor.store.projects.map((row) => this.toProjectRow(row));
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
  async setListingContact(listingId: string, contact: StudioPrivateContact) {
    this.contacts.set(listingId, { ...contact });
  }
  async listListings() {
    return this.listings.map((row) => ({ ...row }));
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
  async listJobs(limit: number) {
    return [...this.jobs.values()]
      .slice(-limit)
      .reverse()
      .map((j) => structuredClone(j));
  }
  async listDueJobs(staleSeconds: number, limit: number) {
    const staleBefore = this.clock() - staleSeconds * 1000;
    return [...this.jobs.values()]
      .filter(
        (job) =>
          job.status === "received" ||
          (job.status === "failed" && job.retryable) ||
          (job.status === "processing" &&
            (job.processing_started_at == null || job.processing_started_at < staleBefore)),
      )
      .slice(0, limit)
      .map((j) => structuredClone(j));
  }

  async claimJob(jobId: string, token: string, staleSeconds: number): Promise<StudioJobRow | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const staleBefore = this.clock() - staleSeconds * 1000;
    // Mirrors studio_claim_job: received | retryable-failed | stale-processing.
    // A published job and a terminal (retryable=false) failure are NEVER
    // reclaimed.
    const claimable =
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

    // Snapshot for atomic rollback (graph + publication + job) on any failure.
    const storeSnapshot = structuredClone(this.executor.store);
    const jobSnapshot = structuredClone(job);
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
      if (!this.objectOwners.has(ownerKey)) this.objectOwners.set(ownerKey, job.created_by);
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

    const slug = input.listing.slug;
    const existing = this.listings.find((row) => row.slug === slug);
    let listingId: string;
    if (existing) {
      listingId = existing.id;
      Object.assign(existing, this.listingRowFrom(input.listing), {
        publication_status: "published",
      });
    } else {
      this.sequence += 1;
      listingId = `listing-${this.sequence}`;
      this.listings.push({
        ...this.listingRowFrom(input.listing),
        id: listingId,
        publication_status: "published",
        updated_at: null,
      });
      this.objectOwners.set(`listing:${listingId}`, job.created_by);
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

  async addListingWarnings(listingId: string, warnings: ProgressiveWarning[]) {
    for (const warning of warnings) this.listingWarnings.push({ listingId, warning });
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

export function makeWorld(): FakeWorld {
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

/** A tiny valid JPEG header (FF D8 FF ... FF D9) for magic-byte media tests. */
export function tinyJpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
  ]);
}

export function tinyPng(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
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
  if (["jpg", "jpeg", "heic", "bmp", "tif", "tiff"].includes(ext))
    return Buffer.concat([tinyJpeg(), suffix]);
  if (["png", "webp", "gif"].includes(ext)) return Buffer.concat([tinyPng(), suffix]);
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
