/**
 * Forever Studio — server boundary contracts.
 *
 * Every effectful capability the orchestrator needs is expressed as a small
 * injectable interface so the whole Studio pipeline is testable against
 * in-memory fakes (including the FakeIngestExecutor model of the progressive
 * RPC and the studio_* transaction functions). The production implementations
 * live in deps.server.ts and are the only Studio code that touches the
 * service-role client.
 */

import type {
  ProgressiveBatch,
  ProgressiveBatchSummary,
  ProgressiveWarning,
} from "@/features/forever-ingestion/batch-types";
import type { ExistingProjectState } from "@/features/forever-ingestion/build-batch";
import type { DependencyReader } from "@/features/forever-ingestion/dependency-resolution";
import type { FieldProvenanceMap } from "@/features/forever-ingestion/provenance";
import type { ExtractedPriceList } from "@/import/types";

import type {
  MediaTruthRecord,
  StudioArchiveEntryState,
  StudioArchiveStatus,
  StudioJobFile,
  StudioJobStatus,
  StudioRole,
  StudioWorkflow,
} from "../studio-types";

// ---------------------------------------------------------------------------
// Actor and access errors
// ---------------------------------------------------------------------------

export interface StudioActor {
  userId: string;
  email: string | null;
  role: StudioRole;
  displayName: string | null;
}

/**
 * Server-boundary refusal (authorization / validation). `code` is stable for
 * tests and UI mapping; `message` is always safe to show; access errors are
 * never retryable.
 */
export class StudioAccessError extends Error {
  readonly code: string;
  readonly retryable = false;
  constructor(code: string, message?: string) {
    super(message ?? code);
    // TanStack Start serializes Error.name and Error.message reliably, while
    // arbitrary custom properties are not guaranteed to survive every
    // server-function transport. Keep the safe, stable code in name as well
    // as code so a browser client can settle on the same denial state.
    this.name = code;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface StudioMembershipRow {
  user_id: string;
  role: StudioRole;
  display_name: string | null;
  email: string | null;
  invited_by: string | null;
  is_active: boolean;
}

export interface StudioJobRow {
  id: string;
  created_by: string | null;
  creator_email: string | null;
  creator_role: StudioRole;
  workflow: StudioWorkflow;
  project_slug: string | null;
  listing_id: string | null;
  status: StudioJobStatus;
  processing_token: string | null;
  processing_requested_at: string | null;
  content_fingerprint: string | null;
  facts: Record<string, unknown>;
  files: StudioJobFile[];
  result_summary: Record<string, unknown> | null;
  error_code: string | null;
  error: string | null;
  retryable: boolean;
  attempt_count: number;
  created_at: string;
}

export interface StudioProjectRow {
  id: string;
  slug: string;
  name: string;
  public_status: string;
  is_active: boolean;
  main_image_url: string | null;
  brochure_url: string | null;
  updated_at: string | null;
}

export interface StudioProjectDetailRow {
  project: StudioProjectRow & Record<string, unknown>;
  media: Array<{ url: string; media_type: string; title: string | null; sort_order: number }>;
}

/** Public listing row — NO contact columns (they live in the private table). */
export interface StudioListingRow {
  id: string;
  slug: string | null;
  title: string;
  publication_status: string;
  project_id: string | null;
  price: number | null;
  currency: string | null;
  photos: string[];
  updated_at: string | null;
}

export interface StudioPrivateContact {
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
}

export interface StudioListingDetailRow extends StudioListingRow, Record<string, unknown> {
  contact: StudioPrivateContact;
}

export interface StudioAuditEntry {
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  metadata: Record<string, unknown>;
}

/** The listing row written by the atomic resale publish (no contact fields). */
export interface StudioListingPublishRow {
  title: string;
  slug: string;
  project_id: string | null;
  project_name_raw: string | null;
  location_id: string | null;
  location_name_raw: string | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqm: number | null;
  price: number | null;
  currency: string | null;
  availability_status: string;
  description: string | null;
  photos: string[];
  field_provenance: FieldProvenanceMap;
}

// ---------------------------------------------------------------------------
// Large-archive rows (FOREVER-STUDIO-LARGE-ARCHIVE-001)
// ---------------------------------------------------------------------------

/** One planned/stored upload part. Sizes and hashes are server-observed. */
export interface StudioArchivePartRecord {
  index: number;
  /** Server-observed stored size (authoritative); null until observed. */
  size: number | null;
  /** Client-declared SHA-256 claim (recorded at confirm; never trusted). */
  declaredSha256: string | null;
  /** Server-computed streamed SHA-256 of the stored part bytes. */
  sha256: string | null;
  verified: boolean;
}

/**
 * Durable artifacts adopted from an archive's structured entries (sanitized
 * price list, source-backed fact fields). Persisted so a later slice or a
 * different worker finalizes from durable state, never an in-memory loop.
 */
export interface StudioArchiveExtracted {
  priceList?: unknown;
  priceListSource?: string;
  factFields?: unknown;
  derivedName?: string;
}

export interface StudioArchiveRow {
  id: string;
  job_id: string;
  /** Plan-order sequence within the job: the deterministic processing order. */
  ordinal: number;
  /** Original client filename — PRIVATE (service-role only); never projected. */
  file_name: string;
  declared_size: number;
  part_size: number;
  part_count: number;
  parts: StudioArchivePartRecord[];
  observed_size: number | null;
  /** SHA-256 over the ordered per-part SHA-256 hex digests (archive identity). */
  composite_sha256: string | null;
  status: StudioArchiveStatus;
  entry_count: number | null;
  total_uncompressed: number | null;
  extracted: StudioArchiveExtracted | null;
  error_code: string | null;
  created_at: string;
}

export interface StudioArchiveEntryRow {
  id: string;
  archive_id: string;
  job_id: string;
  entry_index: number;
  /** Raw entry path — PRIVATE (service-role only); never projected. */
  entry_name: string;
  /** Neutral public-safe label used in warnings and progress UI. */
  display_label: string;
  category: string;
  compressed_size: number;
  uncompressed_size: number;
  observed_size: number | null;
  sha256: string | null;
  media_class: string | null;
  state: StudioArchiveEntryState;
  outcome_code: string | null;
  public_bucket: string | null;
  public_path: string | null;
  public_url: string | null;
  media_type: string | null;
  media_title: string | null;
  /** Full private evidence record (claims allowed — table is service-role only). */
  media_truth: MediaTruthRecord | null;
  /** Attempt discriminator of the claim that settled this entry. */
  attempt: string | null;
  processed_at: string | null;
}

/** Outcome payload for one settled entry (claim-checked, pending-only). */
export interface StudioArchiveEntryOutcome {
  state: Exclude<StudioArchiveEntryState, "pending">;
  outcomeCode: string | null;
  observedSize?: number | null;
  sha256?: string | null;
  mediaClass?: string | null;
  publicBucket?: string | null;
  publicPath?: string | null;
  publicUrl?: string | null;
  mediaType?: string | null;
  mediaTitle?: string | null;
  mediaTruth?: MediaTruthRecord | null;
  attempt: string;
  processedAt: string;
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface StudioData {
  getMembership(userId: string): Promise<StudioMembershipRow | null>;
  listMembers(): Promise<StudioMembershipRow[]>;
  upsertMembership(row: StudioMembershipRow): Promise<void>;
  countActiveOwners(): Promise<number>;
  /** DB-enforced single-winner Owner bootstrap; null when the roster is non-empty. */
  bootstrapOwner(userId: string, email: string): Promise<StudioMembershipRow | null>;

  findProjectBySlug(slug: string): Promise<StudioProjectRow | null>;
  /** Actor ownership is applied by the data query before its 200-row limit. */
  listProjects(createdBy?: string): Promise<StudioProjectRow[]>;
  getProjectDetail(slug: string): Promise<StudioProjectDetailRow | null>;

  /** Internal ownership attribution. Null means legacy/unassigned and Owner-only. */
  getObjectCreatedBy(objectType: "project" | "listing", objectId: string): Promise<string | null>;

  getListing(id: string): Promise<StudioListingRow | null>;
  findListingBySlug(slug: string): Promise<StudioListingRow | null>;
  getListingDetail(id: string): Promise<StudioListingDetailRow | null>;
  updateListing(id: string, patch: Record<string, unknown>): Promise<void>;
  /** Actor ownership is applied by the data query before its 200-row limit. */
  listListings(createdBy?: string): Promise<StudioListingRow[]>;

  createJob(row: StudioJobRow): Promise<void>;
  getJob(id: string): Promise<StudioJobRow | null>;
  /**
   * Claim-checked job metadata update: applies only while the caller still
   * holds the processing claim, so a stale worker can never overwrite a newer
   * claim's records. Returns false when the claim was lost.
   */
  updateJobIfClaimed(id: string, token: string, patch: Partial<StudioJobRow>): Promise<boolean>;
  listJobs(limit: number, createdBy?: string): Promise<StudioJobRow[]>;
  /**
   * Count every explicitly-ready current job whose source still has an active
   * membership. Actor scope and source eligibility are applied in the data
   * query, independently of the bounded history list.
   */
  countActiveJobs(createdBy?: string): Promise<number>;
  /**
   * Ready received, retryable-failed, or stale-processing jobs due for
   * resumption. Current-active-source and actor scope are applied before the
   * bounded result limit.
   */
  listDueJobs(staleSeconds: number, limit: number, createdBy?: string): Promise<StudioJobRow[]>;

  /** Atomically records explicit upload completion and obtains the first claim. */
  requestJobProcessing(
    jobId: string,
    token: string,
    staleSeconds: number,
  ): Promise<StudioJobRow | null>;

  /**
   * Single-winner claim; null if already published, freshly held elsewhere,
   * or failed with retryable=false (a terminal failure is never reclaimed).
   */
  claimJob(jobId: string, token: string, staleSeconds: number): Promise<StudioJobRow | null>;
  /**
   * Lease heartbeat: extends the live claim's processing_started_at so a
   * long-running worker is not mistaken for dead. Returns false when the
   * claim was lost (the worker must stop; it can no longer finalize).
   */
  heartbeatJob(jobId: string, token: string): Promise<boolean>;
  failJob(input: {
    jobId: string;
    token: string;
    errorCode: string;
    message: string;
    retryable: boolean;
  }): Promise<void>;
  /** Atomic ingest + publish + finalize (one transaction). */
  publishProject(input: {
    jobId: string;
    token: string;
    batch: ProgressiveBatch;
    publish: boolean;
    result: Record<string, unknown>;
  }): Promise<ProgressiveBatchSummary & { public_status: string; replayed: boolean }>;
  /** Atomic listing upsert + private contact + warnings + finalize. */
  publishResale(input: {
    jobId: string;
    token: string;
    listing: StudioListingPublishRow;
    contact: StudioPrivateContact;
    warnings: ProgressiveWarning[];
    result: Record<string, unknown>;
  }): Promise<{ listingId: string; slug: string; replayed: boolean }>;

  /** Atomic provenance-ranked resale facts + private contact + conflict warnings. */
  updateResale(input: {
    listingId: string;
    actorId: string;
    fields: Record<string, string | number>;
    contact: Record<string, string>;
    suppliedAt: string;
    /** Test-only rollback injection; production callers always pass false. */
    injectFailure?: boolean;
  }): Promise<{ warnings: ProgressiveWarning[]; appliedFields: string[] }>;

  recordAudit(entry: StudioAuditEntry): Promise<void>;

  // --- Large-archive durable inventory -------------------------------------

  createArchive(row: StudioArchiveRow): Promise<void>;
  getArchive(id: string): Promise<StudioArchiveRow | null>;
  /** Every archive of one job, ordered by (created_at, id) for determinism. */
  listJobArchives(jobId: string): Promise<StudioArchiveRow[]>;
  /**
   * Creator-phase compare-and-set (plan/confirm, before any processing
   * claim): applies only while the archive is in one of `fromStatuses`.
   */
  updateArchivePreProcessing(
    id: string,
    fromStatuses: StudioArchiveStatus[],
    patch: Partial<StudioArchiveRow>,
  ): Promise<boolean>;
  /**
   * Claim-checked archive patch: applies only while the caller holds the
   * job's processing claim, so a stale worker can never move archive state.
   */
  updateArchiveIfClaimed(
    jobId: string,
    token: string,
    archiveId: string,
    patch: Partial<StudioArchiveRow>,
  ): Promise<boolean>;
  /**
   * Claim-checked idempotent inventory insert: entries conflict-skip on
   * (archive_id, entry_index) so a crashed indexing slice resumes without
   * duplicate rows. Returns false when the claim was lost.
   */
  insertArchiveEntriesIfClaimed(
    jobId: string,
    token: string,
    entries: StudioArchiveEntryRow[],
  ): Promise<boolean>;
  /** Entries of one archive ordered by entry_index; optional state filter. */
  listArchiveEntries(
    archiveId: string,
    states?: StudioArchiveEntryState[],
  ): Promise<StudioArchiveEntryRow[]>;
  /** Every entry of a job ordered by (archive created order, entry_index). */
  listJobArchiveEntries(
    jobId: string,
    states?: StudioArchiveEntryState[],
  ): Promise<StudioArchiveEntryRow[]>;
  /**
   * Claim-checked, pending-only settle: the ONLY way an entry leaves
   * `pending`. False when the claim was lost or the entry already settled —
   * the caller must then treat its own side-effect objects as orphans.
   */
  settleArchiveEntryIfClaimed(
    jobId: string,
    token: string,
    entryId: string,
    outcome: StudioArchiveEntryOutcome,
  ): Promise<boolean>;
  /**
   * End-of-slice release: processing → received (readiness marker kept) so
   * the next poll claims and continues promptly instead of waiting for the
   * stale-claim window. Claim-checked; false when the claim was lost.
   */
  releaseJobIfClaimed(jobId: string, token: string): Promise<boolean>;
}

export interface StudioObjectStat {
  size: number;
}

/** Full digest of the actual stored bytes, streamed — never fully buffered. */
export interface StudioObjectDigest {
  /** Full SHA-256 of every stored byte. */
  sha256: string;
  /** Exact server-observed byte count (authoritative over any declaration). */
  size: number;
  /** The leading bytes, for magic-byte media-class detection. */
  head: Buffer;
}

export interface StudioStorage {
  createSignedUpload(bucket: string, path: string): Promise<{ token: string }>;
  /** Object names directly under `prefix`. */
  listNames(bucket: string, prefix: string): Promise<Set<string>>;
  /** Direct child objects under `prefix` with their stored sizes. */
  listObjects(bucket: string, prefix: string): Promise<Array<{ name: string; size: number }>>;
  /** Actual stored byte size and metadata, or null when the object is absent. */
  statObject(bucket: string, path: string): Promise<StudioObjectStat | null>;
  /**
   * Stream the object once to produce its full SHA-256, exact byte count, and
   * leading bytes — bounded memory regardless of object size. Null when the
   * object is absent or cannot be read.
   */
  hashObject(bucket: string, path: string, headBytes: number): Promise<StudioObjectDigest | null>;
  /** Download only when within `maxBytes`; null when absent or over the cap. */
  downloadWithin(bucket: string, path: string, maxBytes: number): Promise<Buffer | null>;

  /** Re-stage an expanded archive entry into the private bucket. */
  upload(bucket: string, path: string, data: Buffer, contentType?: string): Promise<void>;
  remove(bucket: string, paths: string[]): Promise<void>;
  publicUrl(bucket: string, path: string): string;
}

export interface StudioIngest {
  /** Plain enrich patch (publish toggle, later facts edit) — one RPC, one txn. */
  ingest(batch: ProgressiveBatch): Promise<ProgressiveBatchSummary>;
}

export interface StudioAuthAdmin {
  /** Creates a confirmed auth user; returns its id. Owner-invite only. */
  createUser(email: string, password: string): Promise<{ id: string }>;
  /** Looks up an existing auth user by email (auth.users), not just members. */
  findUserIdByEmail(email: string): Promise<string | null>;
}

export interface PriceListPdfExtraction {
  priceList: ExtractedPriceList | null;
  warnings: ProgressiveWarning[];
}

export interface StudioDeps {
  data: StudioData;
  storage: StudioStorage;
  ingest: StudioIngest;
  authAdmin: StudioAuthAdmin;
  reader: DependencyReader;
  fetchExisting(slug: string): Promise<ExistingProjectState | undefined>;
  /** SIP wrapper; resolves with warnings instead of throwing. Unavailable on
   *  runtimes without a subprocess (e.g. the deployed Worker) — retains + warns. */
  extractPriceListPdf(input: {
    projectSlug: string;
    fileName: string;
    buffer: Buffer;
  }): Promise<PriceListPdfExtraction>;
  /**
   * Full-contract ZIP expansion (see server/archive.ts): the complete entry
   * set is validated before any expansion, then entries are streamed ONE AT A
   * TIME through `onEntry`. Resolves with warnings, never throws; a rejected
   * archive expands nothing and never blocks the rest of the upload.
   */
  extractArchive(
    input: { fileName: string; buffer: Buffer },
    onEntry: (entry: { name: string; data: Buffer }) => Promise<void>,
  ): Promise<{ expanded: boolean; warnings: ProgressiveWarning[] }>;
  now(): string;
  /** Fresh opaque processing-claim token. */
  newToken(): string;
  /** Partner Demo must never perform real Studio writes. */
  partnerDemoActive(): boolean;
  ownerBootstrapEmail(): string | null;
  ownerBootstrapUserId(): string | null;
}
