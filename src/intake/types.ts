/**
 * Fast Intake v1 — local, owner-only preparation and validation types.
 *
 * Fast Intake turns normal project source materials (a folder and/or ZIP
 * archives) into a deterministic, validated, UNPUBLISHED Progressive draft
 * payload ready for the existing ordinary draft importer
 * (`scripts/import/Import-ForeverProjectDraft.ps1`).
 *
 * It performs preparation and validation ONLY. It never connects to a
 * database, never creates a client, never makes a network request, never
 * writes to production, and never publishes.
 */

export const INTAKE_SCHEMA_VERSION = "1" as const;

/** Fixed 15-minute product target, expressed in seconds. */
export const INTAKE_TARGET_SECONDS = 900;

/**
 * Deterministic project-material categories already used by Forever, plus the
 * routing-only extras Fast Intake needs. Classification is for routing and
 * warnings — never proof of a fact.
 */
export type IntakeCategory =
  | "brochure"
  | "price-list"
  | "payment-plan"
  | "project-facts"
  | "developer-profile"
  | "master-plan"
  | "floor-plan"
  | "unit-plan"
  | "furniture-package"
  | "map-location"
  | "legal-document"
  | "photo"
  | "video"
  | "archive"
  | "unknown";

export const INTAKE_CATEGORIES: readonly IntakeCategory[] = [
  "brochure",
  "price-list",
  "payment-plan",
  "project-facts",
  "developer-profile",
  "master-plan",
  "floor-plan",
  "unit-plan",
  "furniture-package",
  "map-location",
  "legal-document",
  "photo",
  "video",
  "archive",
  "unknown",
];

/**
 * How Fast Intake v1 can treat a file:
 *  - `structured`  a recognized structured artifact whose facts we consume;
 *  - `inventoried` a recognized raw source (pdf/image/video/document) we
 *                  record but do NOT extract in v1 (no OCR/CV/spreadsheet);
 *  - `unsupported` an unknown file — inventoried, never blocking.
 */
export type IntakeExtractionSupport = "structured" | "inventoried" | "unsupported";

/** One physical file discovered under a source root (or inside an archive). */
export interface SourceManifestFile {
  /** Root-relative, forward-slash logical path; stable across machines. */
  logical_path: string;
  original_filename: string;
  /** Lower-cased normalized extension including the dot, or "" if none. */
  extension: string;
  category: IntakeCategory;
  byte_size: number;
  sha256: string;
  /** Group id shared by byte-identical files; equals the sha256. */
  duplicate_group: string;
  /** True for the first-seen member of a duplicate group. */
  duplicate_primary: boolean;
  /** Present when the file came from inside a ZIP archive root. */
  archive_origin: { root: string; entry: string } | null;
  extraction_support: IntakeExtractionSupport;
  supported: boolean;
  warning_codes: string[];
}

export interface SourceRootManifest {
  id: string;
  kind: "directory" | "archive";
  /** Basename only — never a machine-specific absolute path. */
  name: string;
  /** Absolute path, retained for local operator reference only. */
  local_only_path: string;
}

export interface SourceManifest {
  intake_schema_version: typeof INTAKE_SCHEMA_VERSION;
  project_slug: string;
  intake_started_at: string;
  source_roots: SourceRootManifest[];
  file_count: number;
  duplicate_count: number;
  files: SourceManifestFile[];
}

export interface ClassificationEntry {
  logical_path: string;
  category: IntakeCategory;
  extraction_support: IntakeExtractionSupport;
  warning_codes: string[];
}

export interface ClassificationReport {
  intake_schema_version: typeof INTAKE_SCHEMA_VERSION;
  project_slug: string;
  category_counts: Record<IntakeCategory, number>;
  supported_count: number;
  unsupported_count: number;
  structured_artifacts: string[];
  entries: ClassificationEntry[];
  intake_warnings: IntakeWarning[];
}

/**
 * Operator-facing readiness note about a source file or a missing input.
 * Distinct from a ProgressiveWarning: intake warnings describe the source
 * package, not the import graph.
 */
export interface IntakeWarning {
  code: string;
  severity: "info" | "warning";
  message: string;
  logical_path?: string;
}

/**
 * Progressive field-provenance status vocabulary (mirrors
 * `@/features/forever-ingestion/provenance`). Re-declared as a string union so
 * intake artifacts can carry it without importing the runtime module.
 */
export type IntakeProvenanceStatus =
  | "unverified"
  | "owner_verified"
  | "official_source"
  | "developer_provided"
  | "partner_provided"
  | "extracted"
  | "inferred"
  | "conflicting"
  | "stale";

/** Provenance-carrying fact as read from a source `project-facts.json`. */
export interface IntakeFact<T = string> {
  value: T | null;
  source_file?: string;
  source_type?: string;
  source_ref?: string;
  source_date?: string;
  confidence?: "high" | "medium" | "low" | "none";
  /** Optional explicit provenance status; defaults to `extracted`. */
  status?: IntakeProvenanceStatus;
}

/** Presence flags derived from the inventory, consumed by normalization. */
export interface PhysicalFileCategoryFlags {
  hasMedia: boolean;
  hasDocuments: boolean;
  priceListLogicalPath: string | null;
}

export interface IntakeProjectFacts {
  name?: IntakeFact<string>;
  developer?: IntakeFact<string>;
  location?: IntakeFact<string>;
  location_area?: IntakeFact<string>;
  country?: IntakeFact<string>;
  project_type?: IntakeFact<string>;
  short_description?: IntakeFact<string>;
  full_description?: IntakeFact<string>;
}

export interface ExtractedFacts {
  intake_schema_version: typeof INTAKE_SCHEMA_VERSION;
  project_slug: string;
  /** Fields we actually consumed into the payload, with their provenance. */
  project: {
    name: { value: string; provenance: unknown };
    developer_name_raw?: { value: string; provenance: unknown };
    location_name_raw?: { value: string; provenance: unknown };
    location_area?: { value: string; provenance: unknown };
    project_type?: { value: string; provenance: unknown };
    short_description?: { value: string; provenance: unknown };
  };
  price_list: {
    source_logical_path: string | null;
    price_list_date: string | null;
    row_count: number;
    priced_row_count: number;
    country_currency_evidence: string | null;
  };
  counts: {
    buildings: number;
    units: number;
    prices: number;
  };
}

export type IntakeStatus = "READY_FOR_DRAFT_IMPORT" | "PARTIAL_READY_WITH_WARNINGS" | "BLOCKED";

export interface PlannedGraphCounts {
  projects: number;
  buildings: number;
  units: number;
  prices: number;
  media: number;
  warnings: number;
  batches: number;
}

export interface IntakeSummary {
  intake_schema_version: typeof INTAKE_SCHEMA_VERSION;
  status: IntakeStatus;
  project_slug: string;
  project_name: string;
  elapsed_ms: number;
  elapsed_seconds: number;
  target_seconds: number;
  target_met: boolean;
  source_file_count: number;
  duplicate_count: number;
  classified_counts: Record<IntakeCategory, number>;
  extracted_fact_counts: {
    buildings: number;
    units: number;
    prices: number;
  };
  planned_graph_counts: PlannedGraphCounts;
  validation: {
    ok: boolean;
    fingerprint: string;
    fingerprint_verified: boolean;
    payload_sha256: string;
    source_manifest_sha256: string;
    classification_sha256: string;
    extracted_facts_sha256: string;
    marker: string;
    error: string | null;
  };
  blocking_issues: string[];
  warnings: IntakeWarning[];
  unsupported_files: string[];
  artifacts: {
    source_manifest: string;
    classification: string;
    extracted_facts: string;
    intake_summary: string;
    payload: string;
  };
  next_command: string;
}
