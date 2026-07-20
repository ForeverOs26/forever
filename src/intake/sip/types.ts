/**
 * SIP-001A — narrow local text-PDF price-list extraction types.
 *
 * Structured Input Preparation (SIP) turns one *qualified* text-based PDF
 * price list into candidate `ExtractedPriceList` JSON (unchanged contract,
 * `@/import/types`), validates it, and produces an exception-only review
 * summary. It is not an importer, payload builder, database client,
 * publisher, OCR system, or AI agent. See
 * `docs/STRUCTURED_INPUT_PREPARATION_DESIGN_V1.md`.
 */

export const SIP_SCHEMA_VERSION = "1" as const;

/** Local Poppler `pdftotext` preflight result. Nothing here installs anything. */
export interface PdfToolPreflight {
  found: boolean;
  executablePath: string | null;
  /** Raw `pdftotext -v` stderr/stdout text, when found. */
  versionOutput: string | null;
  /** Parsed semantic version, e.g. "24.02.0", when parseable. */
  version: string | null;
  pdfinfoAvailable: boolean;
  executableSha256: string | null;
  error: string | null;
}

/** One page of raw `pdftotext -layout` output. */
export interface PdfTextPage {
  pageNumber: number;
  text: string;
  nonWhitespaceCharCount: number;
}

export interface PdfTextExtraction {
  toolVersion: string | null;
  exitCode: number;
  pages: PdfTextPage[];
  pageCount: number;
  /** SHA-256 of the complete raw stdout/output-file text, before page splitting. */
  outputSha256: string;
  outputByteLength: number;
  stderrExcerpt: string | null;
  timedOut: boolean;
}

export type QualificationStatus =
  | "QUALIFIED_SUPPORTED_LAYOUT"
  | "UNSUPPORTED_NO_TEXT_LAYER"
  | "UNSUPPORTED_LAYOUT"
  | "REVIEW_REQUIRED"
  | "TOOL_FAILURE";

export interface HeaderMapping {
  page: number;
  tableIndex: number;
  /** Raw header line as it appeared in the source text. */
  rawHeaderLine: string;
  /** Canonical field name -> column label actually matched. */
  columns: Partial<Record<PriceTableField, string>>;
  /** Column start character offsets, in source-line order, for cell splitting. */
  columnStarts: number[];
  columnFields: Array<PriceTableField | null>;
  currencyFromHeader: string | null;
}

export interface QualificationResult {
  status: QualificationStatus;
  reasons: string[];
  pageCount: number;
  nonWhitespaceCharCount: number;
  headerMappings: HeaderMapping[];
}

/** The fixed set of price-table columns SIP-001A knows how to map. Never guessed. */
export type PriceTableField =
  | "unit_number"
  | "unit_type"
  | "building"
  | "bedrooms"
  | "bathrooms"
  | "size_sqm"
  | "price"
  | "availability_status";

export interface RawTableRow {
  page: number;
  tableIndex: number;
  sourceRow: number;
  rawLine: string;
  cells: Partial<Record<PriceTableField, string>>;
  /** True when this row was reconstructed from a wrapped continuation line. */
  isContinuation: boolean;
}

export interface TableRegion {
  page: number;
  tableIndex: number;
  header: HeaderMapping;
  rows: RawTableRow[];
  unsupported: boolean;
  unsupportedReason?: string;
}

export interface PriceTableExtraction {
  regions: TableRegion[];
  unsupportedRegions: TableRegion[];
}

export type ReviewReasonCode =
  | "low_confidence_cell"
  | "medium_confidence_cell"
  | "ambiguous_header"
  | "parser_recovery"
  | "conflicting_value"
  | "duplicate_identity"
  | "unclear_unit_identity"
  | "unclear_date"
  | "unclear_or_inferred_currency"
  | "unsupported_numeric_separator"
  | "unsupported_row"
  | "unsupported_table_region"
  | "price_unsupported_value";

export type ReviewAction = "accept" | "reject" | "edit" | "unresolved" | "accept-as-owner-verified";

export interface ReviewItem {
  id: string;
  reasonCode: ReviewReasonCode;
  candidateValue: unknown;
  rawText: string;
  sourceRef: { source_file: string; page_number: number | null };
  page: number | null;
  table: number | null;
  row: number | null;
  column: PriceTableField | null;
  recommendedAction: ReviewAction;
  allowedActions: ReviewAction[];
  blocking: boolean;
}

export interface ReviewSummary {
  sip_schema_version: typeof SIP_SCHEMA_VERSION;
  project_slug: string;
  items: ReviewItem[];
  blocking_issue_count: number;
  review_required_count: number;
}

export interface SourceProof {
  sip_schema_version: typeof SIP_SCHEMA_VERSION;
  project_slug: string;
  /** Portable filename only — never an absolute Owner-machine path. */
  source_filename: string;
  sha256: string;
  byte_size: number;
  /** Operational-only field; excluded from canonical determinism hashing. */
  local_only_path: string;
}

export interface PreparationSummary {
  sip_schema_version: typeof SIP_SCHEMA_VERSION;
  project_slug: string;
  poppler_version: string | null;
  qualification_status: QualificationStatus;
  pages_detected: number;
  tables_detected: number;
  rows_detected: number;
  candidate_row_count: number;
  accepted_row_count: number;
  review_item_count: number;
  rejected_row_count: number;
  blocking_issues: string[];
  finalized: boolean;
  artifact_hashes: Record<string, string>;
  no_import_statement: string;
  no_publication_statement: string;
}
