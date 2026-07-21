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

/** One declared upload target; the browser uploads directly to storage. */
export interface StudioJobFile {
  name: string;
  bucket: string;
  path: string;
  content_type: string | null;
  size: number | null;
  /** Deterministic routing category (Fast Intake classifier vocabulary). */
  category: string;
  status: "declared" | "uploaded" | "missing" | "unreadable";
}

export interface StudioUploadTarget {
  name: string;
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
  error: string | null;
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
  error: string | null;
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
}

/** Public page path helpers shared by UI and server result summaries. */
export function projectPagePath(slug: string): string {
  return `/projects/${slug}`;
}

export function resalePagePath(slugOrId: string): string {
  return `/resale/${slugOrId}`;
}
