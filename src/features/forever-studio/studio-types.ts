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

import type { StudioArchiveUploadCapability } from "./archive-capability";

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

// ---------------------------------------------------------------------------
// Storage provider (FOREVER-R2-MEDIA-STORAGE-CUTOVER-001)
// ---------------------------------------------------------------------------

/**
 * WHICH storage system holds the heavy bytes of one Studio job.
 *
 * `supabase` is the historical lane (Supabase Storage buckets). `r2` is the
 * Cloudflare R2 lane: the browser uploads bytes straight to R2 through
 * short-lived presigned requests, private sources stay in a private R2 bucket,
 * and verified public derivatives are delivered through Forever's own
 * `/media/…` route.
 *
 * Client-safe: an identifier only. No endpoint, bucket name, account id or
 * credential is ever part of this union or of anything derived from it in the
 * browser.
 */
export type StudioStorageProviderId = "supabase" | "r2";

export const STUDIO_STORAGE_PROVIDERS: readonly StudioStorageProviderId[] = ["supabase", "r2"];

export function isStudioStorageProvider(value: unknown): value is StudioStorageProviderId {
  return (
    typeof value === "string" && (STUDIO_STORAGE_PROVIDERS as readonly string[]).includes(value)
  );
}

/**
 * The ROLE a bucket plays, independent of the provider that implements it.
 *
 * Studio reasons in kinds, never in provider bucket names: `private_source`
 * and `project_archives` are never publicly readable, and `public_media` is the
 * ONLY kind the public delivery route may read. Real bucket names live in
 * server-only configuration.
 */
export type StudioBucketKind = "private_source" | "public_media" | "project_archives";

/**
 * How the browser must deliver bytes for ONE allocated upload target.
 *
 * A discriminated union so the browser can never "guess" a transport: it does
 * exactly what the server told it to, and a target it does not understand is a
 * refusal rather than an improvised request.
 *
 * `r2_presigned_put` carries a complete, already-signed URL. It is a BEARER
 * CREDENTIAL with a short lifetime: it is used once, never logged, never
 * persisted, and never rendered.
 */
export type StudioUploadTransport =
  | { kind: "supabase_signed"; bucket: string; path: string; token: string }
  | { kind: "r2_presigned_put"; url: string; headers: Record<string, string> };

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

// ---------------------------------------------------------------------------
// Explicit material purpose (FOREVER-STUDIO-EXPLICIT-MATERIAL-SLOTS-001)
// ---------------------------------------------------------------------------

/**
 * What the Owner said a directly uploaded file IS.
 *
 * Studio shows one upload window per purpose; uploading into a window IS the
 * routing instruction. This value — not the filename — decides how a directly
 * uploaded file is routed, so `document.pdf` dropped into Price List is a
 * price list and `price-list.pdf` dropped into Documents is a document.
 *
 * Closed vocabulary on purpose. The browser may only send one of these, and
 * the server re-checks the value against this same list before it is trusted
 * (see `isStudioMaterialPurpose` and the server-side validator): an arbitrary
 * string from a browser is never accepted as a routing instruction.
 *
 * Client-safe: a plain string union. The mapping from a purpose into the
 * server's ingestion/media vocabulary lives on the server and never ships to
 * the browser.
 */
export type StudioMaterialPurpose =
  | "brochure"
  | "price_list"
  | "payment_plan"
  | "project_photo"
  | "video"
  | "master_plan"
  | "floor_plan"
  | "unit_plan"
  | "construction_photo"
  | "construction_video"
  | "document_legal"
  | "developer_profile"
  | "map_location"
  | "project_archive";

export const STUDIO_MATERIAL_PURPOSES: readonly StudioMaterialPurpose[] = [
  "brochure",
  "price_list",
  "payment_plan",
  "project_photo",
  "video",
  "master_plan",
  "floor_plan",
  "unit_plan",
  "construction_photo",
  "construction_video",
  "document_legal",
  "developer_profile",
  "map_location",
  "project_archive",
];

/** Whether a string is a purpose Studio recognizes. The server's allowlist. */
export function isStudioMaterialPurpose(value: unknown): value is StudioMaterialPurpose {
  return (
    typeof value === "string" && (STUDIO_MATERIAL_PURPOSES as readonly string[]).includes(value)
  );
}

/**
 * How a routing category was decided. Four values, each truthful about a
 * DIFFERENT thing, so no routing decision can be described as something
 * stronger than it was:
 *
 *   owner_selected              the Owner chose the upload window for THIS
 *                               exact file; authoritative
 *   inherited_explicit_window   an entry expanded from a directly uploaded
 *                               archive that the Owner filed under a specific
 *                               (non-archive) window; the entry inherits that
 *                               window — it was never individually selected
 *   archive_entry_classifier    an entry inside a Full Project Archive / Other
 *                               Package, where the Owner deliberately supplied
 *                               NO per-entry purpose, so the bounded
 *                               deterministic entry classifier routed it
 *   filename_fallback           no explicit purpose exists at all — a manifest
 *                               written before this contract — so the legacy
 *                               filename classifier routed it
 *
 * Recorded so each classifier's reach stays provable rather than assumed. It is
 * routing provenance only — never a review state, a readiness signal, or a
 * verification claim, and it never gates publication. In particular
 * `inherited_explicit_window` and `archive_entry_classifier` must never be
 * reported as `owner_selected`: the Owner chose the package, not the entry.
 */
export type StudioMaterialPurposeSource =
  | "owner_selected"
  | "inherited_explicit_window"
  | "archive_entry_classifier"
  | "filename_fallback";

/** One upload window in the Studio UI. */
export interface StudioMaterialWindow {
  purpose: StudioMaterialPurpose;
  /** Window heading; also the accessible name of its file input. */
  label: string;
  /** One short sentence describing what belongs here. */
  hint: string;
  /** `accept` for this window's picker — a hint to the OS, never a gate. */
  accept: string;
  /** Whether this window also offers direct camera capture. */
  camera: boolean;
  /** Grouping heading used to keep the form compact. */
  group: StudioMaterialGroup;
}

export type StudioMaterialGroup =
  | "Project materials"
  | "Commercial"
  | "Plans"
  | "Construction"
  | "Documents & package";

export const STUDIO_MATERIAL_GROUPS: readonly StudioMaterialGroup[] = [
  "Project materials",
  "Commercial",
  "Plans",
  "Construction",
  "Documents & package",
];

const IMAGE_ACCEPT = "image/*,.heic,.webp";
const VIDEO_ACCEPT = "video/*";
const DOCUMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.json";
const PLAN_ACCEPT = `${DOCUMENT_ACCEPT},image/*`;

/**
 * Every upload window Studio offers, in display order.
 *
 * All are OPTIONAL. Nothing here requires the Owner to prepare folders, rename
 * files, or fill every window — an empty window is simply a material Forever
 * does not have yet, and material can be added at any time later.
 */
export const STUDIO_MATERIAL_WINDOWS: readonly StudioMaterialWindow[] = [
  {
    purpose: "brochure",
    label: "Brochure",
    hint: "The project brochure or e-brochure.",
    accept: DOCUMENT_ACCEPT,
    camera: false,
    group: "Project materials",
  },
  {
    purpose: "project_photo",
    label: "Project Photos / Renders",
    hint: "Photographs and renders of the project.",
    accept: IMAGE_ACCEPT,
    camera: true,
    group: "Project materials",
  },
  {
    purpose: "video",
    label: "Video",
    hint: "Project or promotional video files.",
    accept: VIDEO_ACCEPT,
    camera: false,
    group: "Project materials",
  },
  {
    purpose: "developer_profile",
    label: "Developer / Company Profile",
    // Truthful about the outcome (FOREVER-PR130 review F6): this material may
    // inform the developer details shown on the project page, but the file
    // itself is kept privately and uploading it does not create a public
    // developer section. No public Developer entity exists to promise.
    hint: "Developer background. Kept private; it may inform the project's developer details, not a separate page.",
    accept: `${DOCUMENT_ACCEPT},image/*`,
    camera: false,
    group: "Project materials",
  },
  {
    purpose: "price_list",
    label: "Price List",
    hint: "Prices or availability, whatever the file is called.",
    accept: DOCUMENT_ACCEPT,
    camera: false,
    group: "Commercial",
  },
  {
    purpose: "payment_plan",
    label: "Payment Plan",
    hint: "Payment terms, instalment or deposit schedules.",
    accept: DOCUMENT_ACCEPT,
    camera: false,
    group: "Commercial",
  },
  {
    purpose: "master_plan",
    label: "Master Plan",
    hint: "The site or master plan of the whole development.",
    accept: PLAN_ACCEPT,
    camera: false,
    group: "Plans",
  },
  {
    purpose: "floor_plan",
    label: "Floor Plans",
    hint: "Building or storey floor plans.",
    accept: PLAN_ACCEPT,
    camera: false,
    group: "Plans",
  },
  {
    purpose: "unit_plan",
    label: "Unit Plans",
    hint: "Layouts of individual units, villas or houses.",
    accept: PLAN_ACCEPT,
    camera: false,
    group: "Plans",
  },
  {
    purpose: "map_location",
    label: "Map / Location",
    hint: "Location maps and surrounding-area material.",
    accept: PLAN_ACCEPT,
    camera: false,
    group: "Plans",
  },
  {
    purpose: "construction_photo",
    label: "Construction Photos",
    hint: "Site progress photos — any filename, including straight from the camera.",
    accept: IMAGE_ACCEPT,
    camera: true,
    group: "Construction",
  },
  {
    purpose: "construction_video",
    label: "Construction Videos",
    hint: "Site progress video, including drone footage.",
    accept: VIDEO_ACCEPT,
    camera: false,
    group: "Construction",
  },
  {
    purpose: "document_legal",
    label: "Documents / Legal",
    hint: "Contracts, title documents and other paperwork.",
    accept: DOCUMENT_ACCEPT,
    camera: false,
    group: "Documents & package",
  },
  {
    purpose: "project_archive",
    label: "Full Project Archive / Other Package",
    hint: "A complete ZIP package — no need to sort it first.",
    accept: ".zip",
    camera: false,
    group: "Documents & package",
  },
];

export const STUDIO_MATERIAL_WINDOW_BY_PURPOSE: Record<
  StudioMaterialPurpose,
  StudioMaterialWindow
> = Object.fromEntries(STUDIO_MATERIAL_WINDOWS.map((window) => [window.purpose, window])) as Record<
  StudioMaterialPurpose,
  StudioMaterialWindow
>;

/**
 * Which windows a workflow shows FIRST.
 *
 * Presentation only. Every other window stays reachable in the same form under
 * "More material types" — a workflow narrows the common case, it never removes
 * access to a material the Owner actually has.
 */
export const STUDIO_WORKFLOW_PRIMARY_PURPOSES: Record<
  StudioWorkflow,
  readonly StudioMaterialPurpose[]
> = {
  new_development: [
    "brochure",
    "project_photo",
    "video",
    "developer_profile",
    "price_list",
    "payment_plan",
    "master_plan",
    "floor_plan",
    "unit_plan",
    "map_location",
    "construction_photo",
    "construction_video",
    "document_legal",
    "project_archive",
  ],
  project_update: [
    "brochure",
    "project_photo",
    "video",
    "developer_profile",
    "price_list",
    "payment_plan",
    "master_plan",
    "floor_plan",
    "unit_plan",
    "map_location",
    "construction_photo",
    "construction_video",
    "document_legal",
    "project_archive",
  ],
  price_availability_update: [
    "price_list",
    "payment_plan",
    "document_legal",
    "brochure",
    "project_archive",
  ],
  construction_media_update: [
    "construction_photo",
    "construction_video",
    "document_legal",
    "project_archive",
  ],
  resale_listing: [
    "project_photo",
    "video",
    "floor_plan",
    "unit_plan",
    "document_legal",
    "project_archive",
  ],
};

/** Primary windows for a workflow, in canonical display order. */
export function primaryMaterialWindows(workflow: StudioWorkflow): StudioMaterialWindow[] {
  const primary = new Set(STUDIO_WORKFLOW_PRIMARY_PURPOSES[workflow]);
  return STUDIO_MATERIAL_WINDOWS.filter((window) => primary.has(window.purpose));
}

/** Every remaining window, still reachable, in canonical display order. */
export function additionalMaterialWindows(workflow: StudioWorkflow): StudioMaterialWindow[] {
  const primary = new Set(STUDIO_WORKFLOW_PRIMARY_PURPOSES[workflow]);
  return STUDIO_MATERIAL_WINDOWS.filter((window) => !primary.has(window.purpose));
}

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
  /**
   * Which storage system holds this file's bytes.
   *
   * Written when the job is created and never rewritten: a retry, a resume and
   * a scheduled continuation all read THIS value, never the current global
   * write-provider setting, so flipping the deployment setting can never move
   * an in-flight job's objects to another system. Absent only on manifests
   * written before the provider contract existed, which resolve through the
   * documented Supabase read path.
   */
  storageProvider?: StudioStorageProviderId;
  /** Always the private staging bucket. */
  stagingBucket: string;
  stagingPath: string;
  /** Browser-declared size/type — recorded but never trusted. */
  declaredSize: number | null;
  declaredType: string | null;
  /**
   * The upload window the Owner chose for this file. Authoritative for
   * routing and never re-derived from the filename. Absent only on manifests
   * written before this contract existed.
   */
  materialPurpose?: StudioMaterialPurpose | null;
  /** Whether `category` came from the Owner's window or the legacy fallback. */
  purposeSource?: StudioMaterialPurposeSource;
  /**
   * Routing category in the server's ingestion/media vocabulary. Derived
   * deterministically from `materialPurpose` when the Owner selected a window,
   * and only otherwise from the filename classifier.
   */
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
  /**
   * SERVER-ASSIGNED identity of the declared file this target belongs to: its
   * position in the request's `files` array, which is also the index embedded
   * in the private staging path.
   *
   * This — not array order and never the filename — is how the browser decides
   * which File's bytes go to which signed target. Order is therefore free to
   * change, duplicate filenames stay safe, and the same File selected under two
   * different windows keeps two independent targets. Unique within one job;
   * the browser refuses a response whose identities are missing, out of range,
   * or duplicated rather than uploading to a guessed target.
   */
  fileIndex: number;
  /** Always the private staging bucket (logical name, never an R2 bucket). */
  bucket: string;
  path: string;
  /**
   * LEGACY Supabase signed-upload token.
   *
   * Present only for the Supabase transport, and kept as a top-level field so a
   * browser build that predates `transport` still uploads correctly. The R2
   * transport has no token: it carries a complete presigned request instead.
   */
  token?: string;
  /**
   * How to deliver the bytes. Absent only on a legacy response, which the
   * browser interprets as the Supabase signed lane (and refuses if no token
   * accompanies it) rather than improvising a request of its own.
   */
  transport?: StudioUploadTransport;
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
  /**
   * Directly selected files. `materialPurpose` — the window the Owner uploaded
   * into — is MANDATORY on every one of them.
   *
   * A new direct upload has no legitimate way to omit it: the browser stamps
   * the window onto the selection at pick time, and there is no Studio surface
   * that produces a file without one. Creation therefore never reaches the
   * filename classifier, which now runs only where a purpose genuinely cannot
   * exist: reading a manifest written before this contract, or an entry inside
   * a Full Project Archive (see StudioMaterialPurposeSource).
   */
  files: Array<{
    name: string;
    size?: number;
    contentType?: string;
    materialPurpose: StudioMaterialPurpose;
  }>;
  /**
   * Large archives the browser intends to upload for this job on the resumable
   * lane, declared so the whole submission can be accepted or refused as ONE
   * thing.
   *
   * They are NOT created here — each is planned later on its own endpoint,
   * against this job. Declaring them buys exactly one guarantee: when the
   * resumable lane is unavailable, a mixed submission is refused before the
   * job row, the staging paths and the signed targets exist, instead of
   * leaving a half-made ordinary upload behind for the Owner to clean up.
   *
   * Untrusted, like every other browser input: it cannot create an archive,
   * and omitting it gains nothing, because the plan endpoint refuses on its
   * own authority regardless.
   */
  archives?: Array<{
    name: string;
    size?: number;
    materialPurpose: StudioMaterialPurpose;
  }>;
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

/**
 * What this deployment's upload form may offer right now.
 *
 * Server-derived and closed. The client is TOLD; it never computes this from a
 * filename, a size, a user input or anything it can see in the browser, and it
 * cannot widen it — every archive endpoint re-derives the same answer from the
 * storage plane that would have to do the work.
 */
export interface StudioCapabilities {
  archiveUpload: StudioArchiveUploadCapability;
}

export interface StudioOverview {
  session: StudioSessionInfo;
  capabilities: StudioCapabilities;
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

// ---------------------------------------------------------------------------
// Project amenities (FOREVER-STUDIO-AMENITIES-CORE-001)
// ---------------------------------------------------------------------------

/**
 * Ceiling on featured amenities per project, mirroring the CHECK the
 * `studio_save_project_amenities` function enforces. Declared here so the
 * browser can disable the control BEFORE a save is attempted rather than
 * letting the Owner discover the rule as a server refusal — the database
 * remains the authority, this is only the earlier, kinder statement of it.
 */
export const STUDIO_MAX_FEATURED_AMENITIES = 8;

/**
 * Ceiling on a single `sortOrder` value, mirroring the bound
 * `studio_save_project_amenities` enforces.
 *
 * It exists to stop a value above int4 reaching the function's `::integer`
 * cast, where it would raise a raw `value out of range` instead of a named
 * refusal the app layer can explain. A million is four orders of magnitude
 * above anything a hand-ordered list of amenities needs — the editor renumbers
 * in steps of ten — so a payload beyond it is a bug in the caller, not an
 * unusually long list.
 */
export const STUDIO_MAX_AMENITY_SORT_ORDER = 1_000_000;

/**
 * The category vocabulary a NEWLY CREATED amenity must choose from.
 *
 * Nine values, taken from the completed amenities source-map research rather
 * than invented here. A closed list is the point: category is what the public
 * page groups by, so a free-text field produces "Wellness", "wellness" and
 * "Fitness & Wellness" as three separate headings on three different projects
 * and the grouping stops meaning anything. Growing the vocabulary is a product
 * decision, made by editing this list, not something an Owner does by accident
 * while typing a new amenity's name.
 *
 * This constrains CREATION only. Catalogue rows that predate the rule — including
 * ones with a blank or legacy category — stay readable, selectable and
 * assignable; the migration rewrites nothing. `"Other"` exists so an Owner is
 * never blocked by a genuinely uncategorisable amenity.
 */
export const STUDIO_AMENITY_CATEGORIES = [
  "Pools & Water",
  "Fitness & Wellness",
  "Family & Children",
  "Work & Social",
  "Outdoor & Leisure",
  "Security & Services",
  "Parking & Transport",
  "Hospitality & Retail",
  "Other",
] as const;

export type StudioAmenityCategory = (typeof STUDIO_AMENITY_CATEGORIES)[number];

/** Whether a category string is one a new amenity may be created with. */
export function isStudioAmenityCategory(value: string): value is StudioAmenityCategory {
  return (STUDIO_AMENITY_CATEGORIES as readonly string[]).includes(value);
}

/** One row of the canonical amenity catalogue, for the Studio picker. */
export type StudioAmenityCatalogueEntry = {
  id: string;
  slug: string;
  name: string;
  category: string;
  icon: string;
};

/**
 * One amenity assigned to a project, as the editor holds and submits it.
 *
 * `slug` — not the amenity id — is the identity that crosses the wire: a
 * newly created amenity has no id until the save commits, so the slug is the
 * only key that can name both an existing catalogue row and one being created
 * in the same request.
 */
export type StudioProjectAmenity = {
  slug: string;
  name: string;
  category: string;
  icon: string;
  note: string;
  isFeatured: boolean;
  sortOrder: number;
};

/**
 * A canonical amenity the Owner explicitly asked to create in this save.
 *
 * Creation is always explicit. A requested slug that matches nothing is a
 * refusal, never an implicit insert, so the shared catalogue cannot grow by
 * typo.
 */
export type StudioCreatedAmenity = {
  name: string;
  slug: string;
  category: string;
  icon: string;
};

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

/**
 * Truthful archive lifecycle. Each name states exactly what has been proven
 * about the stored bytes at that point — "stored" is never called "verified":
 *
 *   planned             part plan registered; parts still uploading
 *   uploaded_unverified every part exists with the planned size; NO stored
 *                       byte has been hash-verified yet
 *   byte_verifying      slice-driven per-part streamed SHA-256 verification
 *                       of the actual stored bytes is in progress
 *   byte_verified       EVERY stored part hash-verified against its recorded
 *                       claim ("Archive byte verification passed")
 *   processing_entries  entry inventory persisted durably; entries routing
 *   completed           every entry settled
 *   rejected            safety/verification rejection; original retained
 *                       privately
 */
export type StudioArchiveStatus =
  | "planned"
  | "uploaded_unverified"
  | "byte_verifying"
  | "byte_verified"
  | "processing_entries"
  | "completed"
  | "rejected";

export type StudioArchiveEntryState =
  | "pending"
  | "published_public"
  | "retained_private"
  | "skipped_duplicate"
  | "failed";

/** One part-upload target (private/archive storage, server-chosen location). */
export interface StudioArchivePartTarget {
  index: number;
  bucket: string;
  path: string;
  /** LEGACY Supabase signed-upload token; absent on the R2 multipart lane. */
  token?: string;
  /**
   * How to deliver this part's bytes. Absent only on a legacy response, read as
   * the Supabase signed lane exactly as `StudioUploadTarget.transport` is.
   */
  transport?: StudioUploadTransport;
}

/**
 * One R2 multipart part receipt: the entity tag R2 returned when it accepted
 * the part. Reported by the browser so the server can prove the confirming
 * client uploaded the SAME parts the storage system is holding; the server's
 * own ListParts remains authoritative and a disagreeing claim is refused.
 */
export interface StudioArchivePartReceipt {
  index: number;
  etag: string;
}

export interface StudioArchivePlanInput {
  jobId: string;
  fileName: string;
  declaredSize: number;
  /**
   * The upload window the Owner filed this archive under. MANDATORY, and
   * validated against the same closed allowlist as an ordinary direct file.
   *
   * Transport and purpose are separate dimensions: size and format decide
   * whether an archive travels the ordinary signed lane or this resumable
   * chunked lane, and NEITHER may decide what the material is. The purpose is
   * stored durably on the archive at plan time, so retry and resume never
   * depend on the browser still remembering it, and every entry expanded from
   * an archive filed under a specific window inherits that window instead of
   * being re-guessed from its name.
   */
  materialPurpose: StudioMaterialPurpose;
  /**
   * The exact ordered per-part SHA-256 manifest (one lowercase hex digest per
   * fixed-size upload part, computed sequentially over EVERY byte of the
   * file — see computeUploadPartManifest). Resume identity: re-planning
   * resumes an existing archive ONLY when the complete manifest matches
   * digest-for-digest, so two different archives can never attach to each
   * other's stored parts regardless of filename, byte size, or where the
   * bytes differ. Never a substitute for server verification of the actual
   * stored bytes; stored privately, never projected.
   */
  partSha256: string[];
}

// --- Upload part manifest (resume identity) ---------------------------------

/**
 * Domain/version separator folded into the server-derived manifest identity
 * digest so it can never collide with a plain file hash or the RETIRED v1
 * sampled fingerprint (which hashed only four bounded windows and therefore
 * could not distinguish same-size files differing outside the samples — that
 * contract is removed; every part is now fully hashed).
 */
export const UPLOAD_MANIFEST_DOMAIN = "forever-upload-part-manifest-v2";

/** Fixed part count implied by a declared size (last part may be short). */
export function archivePartCountForSize(declaredSize: number): number {
  return Math.max(1, Math.ceil(declaredSize / ARCHIVE_PART_BYTES));
}

/** Upper bound on parts per archive (300 MiB ceiling / 8 MiB parts). */
export const MAX_ARCHIVE_PARTS = Math.ceil(LARGE_ARCHIVE_MAX_BYTES / ARCHIVE_PART_BYTES);

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
  /**
   * R2 multipart only: the ETag R2 returned for each accepted part. Never
   * trusted on its own — the server lists the parts the storage system
   * actually holds and refuses any part whose claimed ETag disagrees.
   */
  partEtags?: StudioArchivePartReceipt[];
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
  /** Parts durably stored with their planned size (server-observed). */
  uploadedParts: number;
  /** Parts whose ACTUAL stored bytes hash-verified against their claims. */
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
