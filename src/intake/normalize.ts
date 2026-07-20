/**
 * Fast Intake v1 — fact normalization, anti-fabrication, and batch assembly.
 *
 * Raw source values are preserved. A fact is used ONLY when it survives the
 * anti-fabrication guards in `./sanitize` (a usable non-sentinel value, a
 * usable confidence, a present source reference, and a valid date when given).
 * Nothing is inferred from a filename, folder, classification, CLI name, or
 * placeholder. Missing developer, location, country, currency, coordinates,
 * construction status, and media stay null and become explicit warnings.
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

import { isUsableCountry, sanitizePriceList, usableIntakeFact } from "./sanitize";
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
};

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

/**
 * Assemble the unpublished, create-mode Progressive batch from intake facts.
 * Throws `IntakeConflictError` (from sanitize) on a blocking data conflict such
 * as duplicate unit identifiers — the caller treats that as BLOCKED.
 */
export async function normalizeToBatch(input: NormalizeInput): Promise<NormalizeResult> {
  const { facts } = input;
  const fieldProvenance: FieldProvenanceMap = {};
  const warnings: ProgressiveWarning[] = [...(input.extraProgressiveWarnings ?? [])];

  // Anti-fabrication sanitization of the price list (may throw on conflict).
  const sanitized = sanitizePriceList(input.priceList);
  warnings.push(...sanitized.warnings);
  const priceList = sanitized.priceList;

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
  const nameFact = usableIntakeFact(facts.name);
  if (nameFact) {
    project.name = nameFact.value;
    fieldProvenance.name = toFieldProvenance(nameFact);
    if (nameFact.value !== input.projectName.trim()) {
      warnings.push({
        entity: "project",
        field: "name",
        code: "project_name_source_differs",
        severity: "info",
        message: `Source-backed project name "${nameFact.value}" was used instead of the requested "${input.projectName}".`,
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
  const developerFact = usableIntakeFact(facts.developer);
  if (developerFact) {
    project.developer_name_raw = developerFact.value;
    fieldProvenance.developer_name_raw = toFieldProvenance(developerFact);
    extractedProject.developer_name_raw = {
      value: developerFact.value,
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
  const locationFact = usableIntakeFact(facts.location);
  if (locationFact) {
    project.location_name_raw = locationFact.value;
    fieldProvenance.location_name_raw = toFieldProvenance(locationFact);
    extractedProject.location_name_raw = {
      value: locationFact.value,
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

  const areaFact = usableIntakeFact(facts.location_area);
  if (areaFact) {
    project.location_area = areaFact.value;
    fieldProvenance.location_area = toFieldProvenance(areaFact);
    extractedProject.location_area = {
      value: areaFact.value,
      provenance: fieldProvenance.location_area,
    };
  }

  const typeFact = usableIntakeFact(facts.project_type);
  if (typeFact) {
    project.project_type = typeFact.value;
    fieldProvenance.project_type = toFieldProvenance(typeFact);
    extractedProject.project_type = {
      value: typeFact.value,
      provenance: fieldProvenance.project_type,
    };
  }

  const shortFact = usableIntakeFact(facts.short_description);
  if (shortFact) {
    project.short_description = shortFact.value;
    fieldProvenance.short_description = toFieldProvenance(shortFact);
    extractedProject.short_description = {
      value: shortFact.value,
      provenance: fieldProvenance.short_description,
    };
  }
  const fullFact = usableIntakeFact(facts.full_description);
  if (fullFact) {
    project.full_description = fullFact.value;
    fieldProvenance.full_description = toFieldProvenance(fullFact);
  }

  // Country drives ONLY the currency inference rule; it is never stored as a
  // fabricated project field. A malformed or missing country stays a warning.
  let countryEvidence: CurrencyEvidence | undefined;
  let countryCurrencyEvidence: string | null = null;
  const countryFact = usableIntakeFact(facts.country);
  if (countryFact && isUsableCountry(countryFact.value)) {
    countryEvidence = {
      value: countryFact.value,
      status: "source_verified",
      confidence:
        countryFact.confidence === "medium" || countryFact.confidence === "low"
          ? countryFact.confidence
          : "high",
      sourceFile: countryFact.source_file ?? countryFact.source_ref ?? null,
      context: "source-verified project country",
    };
    countryCurrencyEvidence = countryFact.value;
  } else {
    if (countryFact && !isUsableCountry(countryFact.value)) {
      warnings.push({
        entity: "project",
        code: "country_malformed",
        severity: "warning",
        message: `The provided country value was not a plausible country and was not used: "${countryFact.value}".`,
      });
    }
    warnings.push({
      entity: "project",
      code: "country_missing",
      severity: "warning",
      message:
        "No source-backed country was provided; the Owner-approved current Thailand-project scope defaults an absent selling-price currency to THB.",
    });
  }

  // v1 never extracts coordinates or construction status: honest missing.
  warnings.push({
    entity: "project",
    field: "latitude",
    code: "coordinates_missing",
    severity: "info",
    message: "Fast Intake v1 does not extract coordinates; latitude/longitude remain NULL.",
  });
  warnings.push({
    entity: "project",
    field: "construction_status",
    code: "construction_status_missing",
    severity: "info",
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
    priceList,
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
      price_list_date: priceList?.price_list_date?.value ?? null,
      row_count: priceList?.unit_inventory?.length ?? 0,
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
