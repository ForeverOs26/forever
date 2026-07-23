/**
 * Forever Studio — shared contract between the browser UI and the server
 * boundary (FOREVER-STUDIO-001).
 *
 * Client-safe: types and constants only. Everything that touches credentials,
 * storage, or the database lives in ./server/*.server.ts and is reached
 * exclusively through the server functions in studio.functions.ts.
 *
 * Durable product rule: an upload by an authenticated Owner or Trusted
 * Publisher IS direct publication authorization. Incomplete business data
 * never creates a follow-on approval or publication gate.
 */

export interface MediaDimensions {
  width: number;
  height: number;
}

export interface EmbeddedMediaClaims {
  capture_time: string | null;
  timezone: string | null;
  orientation: number | null;
  dimensions: MediaDimensions | null;
  device_make: string | null;
  device_model: string | null;
  software: string | null;
  gps: { latitude: number; longitude: number; altitude: number | null } | null;
}

export interface MediaTruthRecord {
  parser: {
    format: string;
    result:
      | "parsed"
      | "metadata_absent"
      | "malformed"
      | "unsupported"
      | "over_limit"
      | "color_profile_unsupported";
  };
  claims: EmbeddedMediaClaims;
  sensitive_metadata_found: boolean | null;
  sanitization_succeeded: boolean;
  original: { sha256: string; size: number };
  derivative: {
    sha256: string;
    size: number;
    media_class: "image";
    content_type: string;
  } | null;
  sanitizer_version: string;
  verification: {
    result: "verified" | "not_run" | "failed";
    forbidden_metadata: string[];
  };
}

export type StudioRole = "owner" | "trusted_publisher";

export type StudioWorkflow =
  | "new_development"
  | "project_update"
  | "price_availability_update"
  | "construction_media_update"
  | "resale_listing";

export const STUDIO_WORKFLOWS: readonly StudioWorkflow[] = [
  "new_development",
  "project_update",
  "price_availability_update",
  "construction_media_update",
  "resale_listing",
];

export const STUDIO_WORKFLOW_LABELS: Record<StudioWorkflow, string> = {
  new_development: "New Development",
  project_update: "Project Update",
  price_availability_update: "Price / Availability Update",
  construction_media_update: "Construction Media Update",
  resale_listing: "Resale Listing",
};

export type StudioJobStatus = "received" | "processing" | "published" | "failed";

export type StudioJobFileStatus =
  | "declared"
  | "uploaded"
  | "missing"
  | "unreadable"
  | "oversized"
  | "published_public";

/**
 * One upload record. EVERY file is uploaded to the private staging bucket
 * first; only selected, sanitized and byte-verified derivatives are uploaded to a public
 * bucket during finalization. Observed values come from the actual stored
 * bytes, never from the browser's declaration.
 */
export interface StudioJobFile {
  name: string;
  /** Always the private staging bucket. */
  stagingBucket: string;
  stagingPath: string;
  /** Browser-declared size/type — recorded but never trusted. */
  declaredSize: number | null;
  declaredType: string | null;
  /** Deterministic routing category (Fast Intake classifier vocabulary). */
  category: string;
  status: StudioJobFileStatus;
  /** Actual server-observed byte size (streamed count, not the declaration). */
  observedSize?: number | null;
  /** Full SHA-256 of the actual stored bytes (streamed; any size within the cap). */
  sha256?: string | null;
  /** Media class detected from the actual bytes: image|video|pdf|zip|json|other. */
  mediaClass?: string | null;
  /** True when the declared size/type disagrees with the observed bytes. */
  declaredMismatch?: boolean;
  /** Set only for a selected verified derivative uploaded to a public bucket. */
  publicBucket?: string | null;
  publicPath?: string | null;
  /** Private extraction/sanitization evidence; never part of public projections. */
  mediaTruth?: MediaTruthRecord;
  /** Per-entry evidence for media expanded from this private ZIP original. */
  mediaTruthEntries?: Array<{ name: string; mediaTruth: MediaTruthRecord }>;
}

export interface StudioUploadTarget {
  name: string;
  /** Always the private staging bucket. */
  bucket: string;
  path: string;
  /** Signed upload token for supabase.storage.uploadToSignedUrl. */
  token: string;
}

/** Manually entered facts. All optional: missing data never blocks. */
export interface StudioProjectFacts {
  name?: string;
  developerName?: string;
  locationText?: string;
  projectType?: string;
  shortDescription?: string;
  fullDescription?: string;
  constructionStatus?: string;
  ownershipType?: string;
  completionDate?: string;
  startingPriceThb?: number;
  priceRange?: string;
  address?: string;
}

export interface StudioResaleFacts {
  title?: string;
  projectName?: string;
  locationText?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  areaSqm?: number;
  price?: number;
  /** Only when the publisher explicitly supplies it — never defaulted. */
  currency?: string;
  description?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
}

export interface StartJobInput {
  workflow: StudioWorkflow;
  /** Existing project slug (update workflows) or absent for new/resale. */
  projectSlug?: string;
  projectFacts?: StudioProjectFacts;
  resaleFacts?: StudioResaleFacts;
  files: Array<{ name: string; size?: number; contentType?: string }>;
}

export interface StartJobResult {
  jobId: string;
  uploads: StudioUploadTarget[];
}

export interface StudioWarningSummary {
  code: string;
  message: string;
}

export interface StudioJobResult {
  jobId: string;
  status: StudioJobStatus;
  workflow: StudioWorkflow;
  /** Public page path when a page exists (project or resale). */
  pagePath: string | null;
  projectSlug: string | null;
  listingId: string | null;
  publicStatus: string | null;
  counts: {
    buildings: number;
    units: number;
    prices: number;
    media: number;
    warnings: number;
  } | null;
  warnings: StudioWarningSummary[];
  /** Stable safe error code (never a raw database/path/SQL message). */
  errorCode: string | null;
  /** Concise, user-facing explanation. Safe to display. */
  error: string | null;
  /** Whether an automatic or manual retry can still succeed. */
  retryable: boolean;
  /**
   * Present while a large-archive job is mid-processing: the slice completed,
   * the claim was released, and the caller should poll again to continue.
   */
  progress?: StudioJobProgress | null;
}

export interface StudioSessionInfo {
  userId: string;
  email: string | null;
  role: StudioRole;
  displayName: string | null;
}

export interface StudioProjectListItem {
  id: string;
  slug: string;
  name: string;
  publicStatus: string;
  isActive: boolean;
  mainImageUrl: string | null;
  updatedAt: string | null;
}

export interface StudioListingListItem {
  id: string;
  slug: string | null;
  title: string;
  publicationStatus: string;
  price: number | null;
  currency: string | null;
  photos: string[];
  updatedAt: string | null;
}

export interface StudioJobListItem {
  id: string;
  workflow: StudioWorkflow;
  status: StudioJobStatus;
  projectSlug: string | null;
  listingId: string | null;
  creatorEmail: string | null;
  createdAt: string;
  errorCode: string | null;
  error: string | null;
  retryable: boolean;
}

export interface StudioMemberListItem {
  userId: string;
  role: StudioRole;
  email: string | null;
  displayName: string | null;
  isActive: boolean;
}

export interface StudioOverview {
  session: StudioSessionInfo;
  projects: StudioProjectListItem[];
  listings: StudioListingListItem[];
  jobs: StudioJobListItem[];
  /** Owner only; empty for trusted publishers. */
  members: StudioMemberListItem[];
  /** Count of jobs the dashboard is auto-resuming this session. */
  activeJobs: number;
}

/** One editable media candidate for hero selection. */
export interface StudioMediaItem {
  url: string;
  mediaType: string;
  title: string | null;
  sortOrder: number;
  /** True when this image is the current public hero (main_image_url). */
  isHero: boolean;
}

/** Project detail for the edit form: current values + which are public. */
export interface StudioProjectDetail {
  slug: string;
  name: string;
  publicStatus: string;
  isActive: boolean;
  isPublic: boolean;
  facts: StudioProjectFacts;
  mainImageUrl: string | null;
  media: StudioMediaItem[];
  updatedAt: string | null;
  lastSourceDate: string | null;
}

/** Resale detail for the edit form. Includes private contact (Studio may view). */
export interface StudioListingDetail {
  id: string;
  slug: string | null;
  publicationStatus: string;
  isPublic: boolean;
  facts: StudioResaleFacts;
  photos: string[];
  updatedAt: string | null;
}

export interface StudioInviteResult {
  userId: string;
  /** True when a new auth account was created for this invitation. */
  created: boolean;
}

export interface StudioResumeResult {
  resumed: number;
  results: StudioJobResult[];
}

// ---------------------------------------------------------------------------
// Large-archive intake (FOREVER-STUDIO-LARGE-ARCHIVE-001)
// ---------------------------------------------------------------------------

/**
 * Server-defined chunked-upload geometry. The browser slices a large archive
 * into fixed-size parts and uploads each through its own short-lived signed
 * URL; the server verifies the stored bytes of every part before the archive
 * is accepted. Values are returned by the plan endpoint — never client-chosen.
 */
export const ARCHIVE_PART_BYTES = 8 * 1024 * 1024; // 8 MiB
/** Product ceiling for one ZIP archive routed through the large-archive lane. */
export const LARGE_ARCHIVE_MAX_BYTES = 300 * 1024 * 1024; // 300 MiB
/** Archives above the legacy inline limit MUST use the chunked lane. */
export const LARGE_ARCHIVE_MIN_BYTES = 16 * 1024 * 1024; // legacy inline cap
export const MAX_ARCHIVES_PER_JOB = 8;
/** Initial per-job source-material budget (declared bytes, all files+archives). */
export const JOB_SOURCE_BUDGET_BYTES = 1024 * 1024 * 1024; // 1 GiB

export type StudioArchiveStatus =
  | "planned" // part plan registered; parts still uploading
  | "uploaded" // every part present with the planned size; hashes pending
  | "verifying" // slice-driven per-part hash verification in progress
  | "indexed" // entry inventory persisted durably; entries pending
  | "completed" // every entry settled
  | "rejected"; // safety/verification rejection; original retained privately

export type StudioArchiveEntryState =
  | "pending"
  | "published_public"
  | "retained_private"
  | "skipped_duplicate"
  | "failed";

/** One signed part-upload target (private staging bucket, server-chosen path). */
export interface StudioArchivePartTarget {
  index: number;
  bucket: string;
  path: string;
  token: string;
}

export interface StudioArchivePlanInput {
  jobId: string;
  fileName: string;
  declaredSize: number;
}

/**
 * Plan response. `presentParts` lists indexes already stored with the planned
 * size (resume support); `parts` holds fresh signed targets for every part
 * that still needs bytes. Re-planning the same (name, size) returns the SAME
 * archive so an interrupted upload resumes instead of duplicating.
 */
export interface StudioArchivePlanResult {
  archiveId: string;
  partSize: number;
  partCount: number;
  presentParts: number[];
  parts: StudioArchivePartTarget[];
}

export interface StudioArchiveConfirmInput {
  jobId: string;
  archiveId: string;
  /** Client-computed per-part SHA-256 claims (recorded, then server-verified). */
  partSha256: string[];
}

export interface StudioArchiveConfirmResult {
  archiveId: string;
  accepted: boolean;
  /** Parts absent or with a wrong stored size; re-upload via fresh targets. */
  missingParts: StudioArchivePartTarget[];
}

/** Public-safe per-archive progress (labels never expose original filenames). */
export interface StudioArchiveProgress {
  archiveId: string;
  /** Neutral display label ("Archive 1") — original names stay private. */
  label: string;
  status: StudioArchiveStatus;
  partCount: number;
  verifiedParts: number;
  entryCount: number | null;
  entriesProcessed: number;
  entriesPublished: number;
  entriesRetained: number;
  entriesSkipped: number;
  entriesFailed: number;
  warningCode: string | null;
}

export interface StudioJobProgress {
  jobId: string;
  status: StudioJobStatus;
  archives: StudioArchiveProgress[];
  /** Aggregate entry counts across every archive of the job. */
  discovered: number;
  processed: number;
  published: number;
  retained: number;
  skippedDuplicates: number;
  failed: number;
  pending: number;
  warnings: StudioWarningSummary[];
}

/** Public page path helpers shared by UI and server result summaries. */
export function projectPagePath(slug: string): string {
  return `/projects/${slug}`;
}

export function resalePagePath(slugOrId: string): string {
  return `/resale/${slugOrId}`;
}
