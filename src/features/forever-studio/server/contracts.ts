/**
 * Forever Studio — server boundary contracts.
 *
 * Every effectful capability the orchestrator needs is expressed as a small
 * injectable interface so the whole Studio pipeline is testable against
 * in-memory fakes (including the FakeIngestExecutor model of the progressive
 * RPC). The production implementations live in deps.server.ts and are the
 * only Studio code that touches the service-role client.
 */

import type {
  ProgressiveBatch,
  ProgressiveBatchSummary,
  ProgressiveWarning,
} from "@/features/forever-ingestion/batch-types";
import type { ExistingProjectState } from "@/features/forever-ingestion/build-batch";
import type { DependencyReader } from "@/features/forever-ingestion/dependency-resolution";
import type { ListingRowPayload } from "@/features/forever-ingestion/listings";
import type { ExtractedPriceList } from "@/import/types";

import type { StudioJobFile, StudioJobStatus, StudioRole, StudioWorkflow } from "../studio-types";

// ---------------------------------------------------------------------------
// Actor and access errors
// ---------------------------------------------------------------------------

export interface StudioActor {
  userId: string;
  email: string | null;
  role: StudioRole;
  displayName: string | null;
}

/** Server-boundary refusal. `code` is stable for tests and UI mapping. */
export class StudioAccessError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "StudioAccessError";
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
  created_by: string;
  creator_email: string | null;
  creator_role: StudioRole;
  workflow: StudioWorkflow;
  project_slug: string | null;
  listing_id: string | null;
  status: StudioJobStatus;
  facts: Record<string, unknown>;
  files: StudioJobFile[];
  result_summary: Record<string, unknown> | null;
  error: string | null;
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

export interface StudioAuditEntry {
  actor_id: string;
  actor_email: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface StudioData {
  getMembership(userId: string): Promise<StudioMembershipRow | null>;
  listMembers(): Promise<StudioMembershipRow[]>;
  upsertMembership(row: StudioMembershipRow): Promise<void>;
  countActiveOwners(): Promise<number>;
  countMembers(): Promise<number>;

  findProjectBySlug(slug: string): Promise<StudioProjectRow | null>;
  listProjects(): Promise<StudioProjectRow[]>;

  getListing(id: string): Promise<StudioListingRow | null>;
  findListingBySlug(slug: string): Promise<StudioListingRow | null>;
  insertListing(
    row: Omit<ListingRowPayload, "publication_status"> & {
      publication_status: string;
      slug: string | null;
    },
  ): Promise<{ id: string }>;
  updateListing(id: string, patch: Record<string, unknown>): Promise<void>;
  listListings(): Promise<StudioListingRow[]>;
  insertListingWarnings(listingId: string, warnings: ProgressiveWarning[]): Promise<void>;

  createJob(row: StudioJobRow): Promise<void>;
  getJob(id: string): Promise<StudioJobRow | null>;
  updateJob(id: string, patch: Partial<StudioJobRow>): Promise<void>;
  listJobs(limit: number): Promise<StudioJobRow[]>;

  recordAudit(entry: StudioAuditEntry): Promise<void>;
}

export interface StudioStorage {
  createSignedUpload(bucket: string, path: string): Promise<{ token: string }>;
  /** Names (not paths) of objects directly under `prefix`. */
  listNames(bucket: string, prefix: string): Promise<Set<string>>;
  download(bucket: string, path: string): Promise<Buffer | null>;
  upload(bucket: string, path: string, data: Buffer, contentType?: string): Promise<void>;
  publicUrl(bucket: string, path: string): string;
}

export interface StudioIngest {
  ingest(batch: ProgressiveBatch): Promise<ProgressiveBatchSummary>;
}

export interface StudioAuthAdmin {
  /** Creates a confirmed auth user; returns its id. Owner-invite only. */
  createUser(email: string, password: string): Promise<{ id: string }>;
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
  /** SIP wrapper; resolves with warnings instead of throwing. */
  extractPriceListPdf(input: {
    projectSlug: string;
    fileName: string;
    buffer: Buffer;
  }): Promise<PriceListPdfExtraction>;
  /** Bounded ZIP expansion; resolves entries or warnings, never throws. */
  extractArchive(input: {
    fileName: string;
    buffer: Buffer;
  }): Promise<{ entries: Array<{ name: string; data: Buffer }>; warnings: ProgressiveWarning[] }>;
  now(): string;
  /** Partner Demo must never perform real Studio writes. */
  partnerDemoActive(): boolean;
  ownerBootstrapEmail(): string | null;
}
