/**
 * Package Factory — shared contracts.
 *
 * Everything the pipeline passes between stages is declared here so a new
 * adapter, a new parser layout or a new document class plugs in without any
 * existing stage changing.
 */

import type { SourceAuthority, SourceKind } from "./source-set";

/** Document classes the Factory can name. Routing and precedence only. */
export const DOCUMENT_CLASSES = [
  "project_brochure",
  "fact_sheet",
  "company_profile",
  "price_list",
  "availability_list",
  "master_plan",
  "floor_plan",
  "unit_plan",
  "site_plan",
  "location_map",
  "payment_plan",
  "promotion",
  "construction_update",
  "photo",
  "video",
  "other_official_document",
] as const;

export type DocumentClass = (typeof DOCUMENT_CLASSES)[number];

/**
 * One artifact produced by an adapter.
 *
 * `ref` is the only identifier that may ever be shown publicly: it is a
 * basename, never a path, never a URL carrying a token.
 */
export interface ResolvedArtifact {
  /** Stable public-safe reference (basename). */
  ref: string;
  /** Logical path inside the artifact's own source, forward slashes. */
  logicalPath: string;
  kind: SourceKind;
  authority: SourceAuthority;
  /** Opaque private locator, for the operator's local report only. */
  privateLocator: string;
  bytes: Buffer;
  sha256: string;
  /** When the source distributed it, if known. */
  publishedAt: string | null;
  /** What the document itself states, if known. Beats publishedAt. */
  effectiveDate: string | null;
  /** Official revision label, e.g. "V2". */
  revision: string | null;
  /** Set when this artifact is byte-identical to an earlier one. */
  repostOf: string | null;
  documentClass: DocumentClass | null;
}

/** A source that carries no bytes — a reference the Factory records only. */
export interface ResolvedReference {
  ref: string;
  kind: SourceKind;
  authority: SourceAuthority;
  privateLocator: string;
  publishedAt: string | null;
  note: string | null;
}

export interface AdapterFailure {
  kind: SourceKind;
  /** Public-safe description; never the private locator. */
  ref: string;
  code: string;
  message: string;
}

export interface ResolvedSources {
  artifacts: ResolvedArtifact[];
  references: ResolvedReference[];
  /** Files dropped before hashing (AppleDouble, dotfiles, oversize). */
  skipped: Array<{ ref: string; reason: string }>;
  failures: AdapterFailure[];
  /** Existing production record the source set explicitly pointed at. */
  existingRecordSlugs: string[];
}

/** One unit row accepted by a parser. */
export interface ParsedUnitRow {
  unitCode: string;
  building: string | null;
  floor: number | null;
  unitType: string | null;
  typeCode: string | null;
  sizeSqm: number | null;
  landAreaSqm: number | null;
  pricePerSqm: number | null;
  totalPrice: number | null;
  availabilityStatus: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  page: number;
}

export interface RejectedRow {
  /** The raw line, whitespace-squashed. Kept private, reported to the Owner. */
  line: string;
  reason: string;
  page: number;
}

export interface ParseOutcome {
  layoutId: string;
  layoutFamily: string;
  accepted: ParsedUnitRow[];
  rejected: RejectedRow[];
  /** Lines that looked like they carried a unit identity but matched nothing. */
  unresolved: RejectedRow[];
  validationMethod: string;
  /** Currency codes evidenced by the document itself. Never defaulted. */
  currencies: string[];
}

export interface FactoryException {
  code: string;
  severity: "blocker" | "attention";
  message: string;
  detail?: string;
}
