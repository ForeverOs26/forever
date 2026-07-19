/**
 * Fast Intake v1 — fact normalization, anti-fabrication, and batch assembly.
 *
 * Raw source values are preserved. A fact is used ONLY when it is source-backed
 * (a non-empty value, a source reference, and confidence above "none").
 * Nothing is inferred from a filename. Missing developer, location, country,
 * currency, coordinates, construction status, and media stay null and become
 * explicit warnings — never `"Unknown"`, `0`, or an empty-string placeholder.
 *
 * The Progressive batch itself is assembled by the existing, unchanged builder
 * (`buildProgressiveBatch`), which owns the currency doctrine, dependency
 * resolution, precedence filtering, and the deterministic fingerprint.
 */

import type { CurrencyEvidence } from "@/import/currency-policy";
import type { ExtractedPriceList } from "@/import/types";
import type {
  ProgressiveBatch,
  ProgressiveProjectPayload,
  ProgressiveWarning,
} from "@/features/forever-ingestion/batch-types";
import { buildProgressiveBatch } from "@/features/forever-ingestion/build-batch";
import type { DependencyReader } from "@/features/forever-ingestion/dependency-resolution";
import type {
  FieldProvenance,
  FieldProvenanceMap,
  ProvenanceStatus,
} from "@/features/forever-ingestion/provenance";

import type {
  ExtractedFacts,
  IntakeFact,
  IntakeProjectFacts,
  PhysicalFileCategoryFlags,
} from "./types";
import { INTAKE_SCHEMA_VERSION } from "./types";

/** Offline resolver: no database, no network. Every dependency stays unlinked. */
const offlineReader: DependencyReader = {
  findDevelopers: async () => [],
  findLocations: async () => [],
};

const CONFIDENCE_TO_NUMBER: Record<string, number> = {
  high: 1,
  medium: 0.7,
  low: 0.4,
  none: 0,
};

function isSourceBacked(fact: IntakeFact | undefined): fact is IntakeFact & { value: string } {
  return Boolean(
    fact &&
    typeof fact.value === "string" &&
    fact.value.trim().length > 0 &&
    fact.confidence !== "none" &&
    (fact.source_file || fact.source_ref),
  );
}

function toFieldProvenance(fact: IntakeFact): FieldProvenance {
  const status: ProvenanceStatus = fact.status ?? "extracted";
  const provenance: FieldProvenance = { status };
  if (fact.source_type) provenance.source_type = fact.source_type;
  const ref = fact.source_ref ?? fact.source_file;
  if (ref) provenance.source_ref = ref;
  if (fact.source_date) provenance.source_date = fact.source_date;
  if (fact.confidence && fact.confidence in CONFIDENCE_TO_NUMBER) {
    provenance.confidence = CONFIDENCE_TO_NUMBER[fact.confidence];
  }
  return provenance;
}

export interface NormalizeInput {
  projectSlug: string;
  projectName: string;
  facts: IntakeProjectFacts;
  priceList: ExtractedPriceList | null;
  categoryFlags: PhysicalFileCategoryFlags;
  /** Intake-level warnings already accumulated (inventory + extraction). */
  extraProgressiveWarnings?: ProgressiveWarning[];
}

export interface NormalizeResult {
  batch: ProgressiveBatch;
  extractedFacts: ExtractedFacts;
}

/** Assemble the unpublished, create-mode Progressive batch from intake facts. */
export async function normalizeToBatch(input: NormalizeInput): Promise<NormalizeResult> {
  const { facts } = input;
  const fieldProvenance: FieldProvenanceMap = {};
  const warnings: ProgressiveWarning[] = [...(input.extraProgressiveWarnings ?? [])];

  const project: ProgressiveProjectPayload = {
    slug: input.projectSlug,
    name: input.projectName,
    developer_id: null,
    location_id: null,
    publish: false,
  };

  const extractedProject: ExtractedFacts["project"] = {
    name: { value: input.projectName, provenance: {} },
  };

  // Name: prefer a source-backed fact; otherwise the operator-supplied name.
  if (isSourceBacked(facts.name)) {
    project.name = facts.name.value.trim();
    fieldProvenance.name = toFieldProvenance(facts.name);
    if (facts.name.value.trim() !== input.projectName.trim()) {
      warnings.push({
        entity: "project",
        field: "name",
        code: "project_name_source_differs",
        severity: "info",
        message: `Source-backed project name "${facts.name.value.trim()}" was used instead of the requested "${input.projectName}".`,
      });
    }
  } else {
    fieldProvenance.name = {
      status: "owner_verified",
      source_type: "operator_intake",
      note: "Project name supplied by the Owner at Fast Intake.",
    };
  }
  extractedProject.name = { value: project.name!, provenance: fieldProvenance.name };

  // Developer: source-backed only; otherwise preserved-null with a warning.
  if (isSourceBacked(facts.developer)) {
    project.developer_name_raw = facts.developer.value.trim();
    fieldProvenance.developer_name_raw = toFieldProvenance(facts.developer);
    extractedProject.developer_name_raw = {
      value: project.developer_name_raw,
      provenance: fieldProvenance.developer_name_raw,
    };
  } else {
    warnings.push({
      entity: "developer",
      code: "developer_missing",
      severity: "warning",
      message:
        "No source-backed developer was provided; developer_id remains NULL and no canonical developer was created.",
    });
  }

  // Location: source-backed only; otherwise preserved-null with a warning.
  if (isSourceBacked(facts.location)) {
    project.location_name_raw = facts.location.value.trim();
    fieldProvenance.location_name_raw = toFieldProvenance(facts.location);
    extractedProject.location_name_raw = {
      value: project.location_name_raw,
      provenance: fieldProvenance.location_name_raw,
    };
  } else {
    warnings.push({
      entity: "location",
      code: "location_missing",
      severity: "warning",
      message:
        "No source-backed location was provided; location_id remains NULL and no canonical location was created.",
    });
  }

  if (isSourceBacked(facts.location_area)) {
    project.location_area = facts.location_area.value.trim();
    fieldProvenance.location_area = toFieldProvenance(facts.location_area);
    extractedProject.location_area = {
      value: project.location_area,
      provenance: fieldProvenance.location_area,
    };
  }

  if (isSourceBacked(facts.project_type)) {
    project.project_type = facts.project_type.value.trim();
    fieldProvenance.project_type = toFieldProvenance(facts.project_type);
    extractedProject.project_type = {
      value: project.project_type,
      provenance: fieldProvenance.project_type,
    };
  }

  if (isSourceBacked(facts.short_description)) {
    project.short_description = facts.short_description.value.trim();
    fieldProvenance.short_description = toFieldProvenance(facts.short_description);
    extractedProject.short_description = {
      value: project.short_description,
      provenance: fieldProvenance.short_description,
    };
  }
  if (isSourceBacked(facts.full_description)) {
    project.full_description = facts.full_description.value.trim();
    fieldProvenance.full_description = toFieldProvenance(facts.full_description);
  }

  // Country drives ONLY the currency inference rule; it is never stored as a
  // fabricated project field. Missing country stays a warning.
  let countryEvidence: CurrencyEvidence | undefined;
  let countryCurrencyEvidence: string | null = null;
  if (isSourceBacked(facts.country)) {
    countryEvidence = {
      value: facts.country.value.trim(),
      status: "source_verified",
      confidence:
        facts.country.confidence === "medium" || facts.country.confidence === "low"
          ? facts.country.confidence
          : "high",
      sourceFile: facts.country.source_file ?? facts.country.source_ref ?? null,
      context: "source-verified project country",
    };
    countryCurrencyEvidence = facts.country.value.trim();
  } else {
    warnings.push({
      entity: "project",
      code: "country_missing",
      severity: "warning",
      message:
        "No source-backed country was provided; currency cannot be inferred and remains NULL unless a price row states it.",
    });
  }

  // v1 never extracts coordinates or construction status: honest missing.
  warnings.push({
    entity: "project",
    field: "latitude",
    code: "coordinates_missing",
    severity: "warning",
    message: "Fast Intake v1 does not extract coordinates; latitude/longitude remain NULL.",
  });
  warnings.push({
    entity: "project",
    field: "construction_status",
    code: "construction_status_missing",
    severity: "warning",
    message:
      "Fast Intake v1 does not extract construction status or completion date; these remain NULL.",
  });

  // Media/documents are inventoried but not attached: no stable RPC-supported
  // URL exists for repository-local media in v1.
  if (input.categoryFlags.hasMedia) {
    warnings.push({
      entity: "media",
      code: "media_processing_deferred",
      severity: "info",
      message:
        "Repository-local media has no stable storage URL supported by the importer; media ingestion is deferred (0 media rows).",
    });
  }
  if (input.categoryFlags.hasDocuments) {
    warnings.push({
      entity: "document",
      code: "document_processing_deferred",
      severity: "info",
      message:
        "Repository-local documents have no stable storage URL supported by the importer; document ingestion is deferred.",
    });
  }

  if (Object.keys(fieldProvenance).length > 0) {
    project.field_provenance = fieldProvenance;
  }

  const batch = await buildProgressiveBatch(offlineReader, {
    mode: "create",
    project,
    priceList: input.priceList,
    countryEvidence,
    extraWarnings: warnings,
  });

  const pricedRows = batch.prices?.length ?? 0;
  const extractedFacts: ExtractedFacts = {
    intake_schema_version: INTAKE_SCHEMA_VERSION,
    project_slug: input.projectSlug,
    project: extractedProject,
    price_list: {
      source_logical_path: input.priceList ? input.categoryFlags.priceListLogicalPath : null,
      price_list_date: input.priceList?.price_list_date?.value ?? null,
      row_count: input.priceList?.unit_inventory?.length ?? 0,
      priced_row_count: pricedRows,
      country_currency_evidence: countryCurrencyEvidence,
    },
    counts: {
      buildings: batch.buildings?.length ?? 0,
      units: batch.units?.length ?? 0,
      prices: pricedRows,
    },
  };

  return { batch, extractedFacts };
}
