/**
 * Modeva extraction facts, stated through the RC4.5 Extraction Pipeline model.
 *
 * Every fact below is a verbatim transcription of a committed repository
 * artifact — the canonical seed migration (FDB-001), the reviewed price-list
 * import migration (FDB-002C), or the real-run verification report
 * (FDB-003C). Nothing is read from the live database and nothing is
 * transcribed from the seeded demo projects (Surin Ridge etc.), which are
 * fictional display data, not Modeva statements.
 *
 * Confidence is a stated, documented policy — no score is invented per fact:
 *
 * - facts stated by the reviewed price-list import (FDB-002C) carry `high`:
 *   the migration's own header calls its content a "reviewed price-list
 *   extraction";
 * - facts stated by the real-run report (FDB-003C) carry `high`: they are
 *   recorded observations of the connected database and the import's output;
 * - facts stated only by the canonical seed (FDB-001) carry `medium`: the
 *   seed itself records "Awaiting full Forever inspection data".
 *
 * The CRITICAL ANTI-FABRICATION RULE governs this module:
 *
 * - a value the committed artifacts do not state gets NO fact — it is listed
 *   in {@link MODEVA_EXPECTED_MISSING_PATHS} instead, so RC4.7 reports it as
 *   `missing_information` rather than this module inventing it. In
 *   particular the seed's placeholder strings (trust score 0, "Under
 *   review", empty display fields) are NOT facts — they are the seed saying
 *   it does not know;
 * - where two artifacts independently state the same value (the seed and
 *   the real-run report both state the project name, developer, and area),
 *   BOTH statements are kept so RC4.7 can judge the corroboration itself.
 */

import {
  describeExtractionFact,
  extractionConfidence,
  extractionLocator,
  extractionMethod,
  type ExtractionConfidenceLevel,
  type ExtractionFact,
  type ExtractionFactType,
  type ExtractionStructuredValue,
} from "@/features/forever-extraction-pipeline";
import type { ProjectKnowledgeGap } from "@/features/forever-project-knowledge";
import type { ProjectSourceDefinition } from "@/features/forever-project-sources";

import { MODEVA_DATASETS, MODEVA_KNOWLEDGE_EXTRACTED_AT, MODEVA_SLUG } from "./identity";
import {
  MODEVA_CANONICAL_SEED_SOURCE,
  MODEVA_PRICE_LIST_IMPORT_SOURCE,
  MODEVA_REAL_RUN_REPORT_SOURCE,
} from "./sources";

/** Buildings exactly as the price-list import migration states them (`building_source` VALUES). */
export const MODEVA_BUILDINGS: readonly string[] = ["A", "B", "C", "D", "E", "F", "G"];

/**
 * Unit-type labels exactly as the price-list import migration's 289 rows
 * state them (distinct `unit_type` values, in label order). Unlike Coralina,
 * no second committed artifact states a unit-type vocabulary, so there is
 * nothing to corroborate or dispute — this is a single-source statement.
 */
export const MODEVA_UNIT_TYPE_LABELS: readonly string[] = [
  "1 BEDROOM L",
  "1 BEDROOM LA",
  "1 BEDROOM LC",
  "1 BEDROOM M",
  "1 BEDROOM MA",
  "1 BEDROOM MC",
  "1 BEDROOM PLUS",
  "1 BEDROOM PLUS A",
  "1 BEDROOM PLUS C",
  "1 BEDROOM S",
  "1 BEDROOM SC",
  "1 BEDROOM SC1",
  "2 BEDROOM DPA",
  "2 BEDROOM DPAC",
  "3 BEDROOM DPAC",
  "3 BEDROOM DPRC",
];

/**
 * The field paths Modeva's committed artifacts do NOT state. RC4.7 receives
 * these as `expectedPaths`, so each one surfaces as an explicit
 * `missing_information` finding instead of a fabricated value. None is a
 * manifest blocker because Modeva has no committed intake manifest at all —
 * that absence surfaces through the readiness profile's required-source
 * statements instead.
 */
export const MODEVA_EXPECTED_MISSING_PATHS: readonly ProjectKnowledgeGap[] = [
  {
    path: "location.coordinates",
    reason: "no committed Modeva artifact states GPS coordinates",
  },
  {
    path: "location.beachDistance",
    reason:
      "the canonical seed states only 'Bang Tao area' for distance_to_beach — a label, not a measured distance",
  },
  {
    path: "construction.completionDate",
    reason:
      "the canonical seed states an empty completion_date_display — the completion date is explicitly not stated",
  },
  {
    path: "pricing.startingPrice",
    reason: "the canonical seed states starting_price_thb NULL — no starting price is stated",
  },
  {
    path: "amenities.highlights",
    reason:
      "no developer brochure or facilities document is committed for Modeva; the seed's highlights are Forever placeholders, not source statements",
  },
  {
    path: "rental.yield",
    reason: "no rental or investment artifact is committed for Modeva",
  },
];

interface ModevaFactSpec {
  factSlug: string;
  factType: ExtractionFactType;
  fieldPath: string;
  source: ProjectSourceDefinition;
  /** Committed artifact the value is transcribed from (cited in provenance). */
  dataset: string;
  rawValue?: string;
  structuredValue?: ExtractionStructuredValue;
  confidence: ExtractionConfidenceLevel;
  locatorDetail: string;
  excerpt?: string;
}

function modevaFact(spec: ModevaFactSpec): ExtractionFact {
  return describeExtractionFact({
    projectSlug: MODEVA_SLUG,
    factSlug: spec.factSlug,
    factType: spec.factType,
    sourceId: spec.source.identity.id,
    sourceVersion: spec.source.version,
    method: extractionMethod("manual", {
      tool: spec.dataset,
      description: "Transcribed verbatim from a committed Modeva artifact; nothing inferred.",
    }),
    extractedAt: MODEVA_KNOWLEDGE_EXTRACTED_AT,
    fieldPath: spec.fieldPath,
    rawValue: spec.rawValue,
    structuredValue: spec.structuredValue,
    confidence: extractionConfidence(spec.confidence),
    // Migrations and reports have no page numbers; the locator names the
    // statement inside the document instead.
    locator: extractionLocator("document", { detail: spec.locatorDetail }),
    excerpt: spec.excerpt,
  });
}

/** Project name as the canonical seed states it (projects insert VALUES). */
export const MODEVA_NAME_SEED_FACT = modevaFact({
  factSlug: "project-name-seed",
  factType: "project_name",
  fieldPath: "general.name",
  source: MODEVA_CANONICAL_SEED_SOURCE,
  dataset: MODEVA_DATASETS.canonicalSeed,
  rawValue: "Modeva",
  confidence: "medium",
  locatorDetail: "INSERT INTO public.projects VALUES — name 'Modeva', slug 'modeva'",
  excerpt: "'Modeva',\n  'modeva',",
});

/** Project name as the real-run report independently records it (before-counts JSON). */
export const MODEVA_NAME_REAL_RUN_FACT = modevaFact({
  factSlug: "project-name-real-run",
  factType: "project_name",
  fieldPath: "general.name",
  source: MODEVA_REAL_RUN_REPORT_SOURCE,
  dataset: MODEVA_DATASETS.realRunReport,
  rawValue: "Modeva",
  confidence: "high",
  locatorDetail: 'Before Counts JSON — "project": { "slug": "modeva", "name": "Modeva" }',
  excerpt: '"slug": "modeva",\n    "name": "Modeva",',
});

/** Project type as the canonical seed states it. */
export const MODEVA_PROJECT_TYPE_FACT = modevaFact({
  factSlug: "project-type",
  factType: "property_type",
  fieldPath: "general.projectType",
  source: MODEVA_CANONICAL_SEED_SOURCE,
  dataset: MODEVA_DATASETS.canonicalSeed,
  rawValue: "Condominium",
  confidence: "medium",
  locatorDetail: "INSERT INTO public.projects VALUES — project_type",
  excerpt: "'Condominium',",
});

/** Developer as the canonical seed states it (developer_seed CTE). */
export const MODEVA_DEVELOPER_SEED_FACT = modevaFact({
  factSlug: "developer-seed",
  factType: "developer",
  fieldPath: "developer.name",
  source: MODEVA_CANONICAL_SEED_SOURCE,
  dataset: MODEVA_DATASETS.canonicalSeed,
  rawValue: "Title",
  confidence: "medium",
  locatorDetail: "developer_seed CTE — slug 'title', name 'Title', legal_name 'Title'",
  excerpt: "'title',\n    'Title',\n    'Title',",
});

/** Developer as the real-run report independently records it (import output). */
export const MODEVA_DEVELOPER_REAL_RUN_FACT = modevaFact({
  factSlug: "developer-real-run",
  factType: "developer",
  fieldPath: "developer.name",
  source: MODEVA_REAL_RUN_REPORT_SOURCE,
  dataset: MODEVA_DATASETS.realRunReport,
  rawValue: "Title",
  confidence: "high",
  locatorDetail: "Import Output — [OK] Developer - Title",
  excerpt: "[OK] Developer - Title",
});

/** Primary area as the canonical seed states it (location_seed CTE and location_area). */
export const MODEVA_AREA_SEED_FACT = modevaFact({
  factSlug: "area-seed",
  factType: "location",
  fieldPath: "location.area",
  source: MODEVA_CANONICAL_SEED_SOURCE,
  dataset: MODEVA_DATASETS.canonicalSeed,
  rawValue: "Bang Tao",
  confidence: "medium",
  locatorDetail: "location_seed CTE — area_name 'Bang Tao'; projects.location_area 'Bang Tao'",
  excerpt: "'bang-tao',\n    'Bang Tao',",
});

/** Primary area as the real-run report independently records it (import output). */
export const MODEVA_AREA_REAL_RUN_FACT = modevaFact({
  factSlug: "area-real-run",
  factType: "location",
  fieldPath: "location.area",
  source: MODEVA_REAL_RUN_REPORT_SOURCE,
  dataset: MODEVA_DATASETS.realRunReport,
  rawValue: "Bang Tao",
  confidence: "high",
  locatorDetail: "Import Output — [OK] Location - Bang Tao",
  excerpt: "[OK] Location - Bang Tao",
});

/** Province as the canonical seed states it. */
export const MODEVA_PROVINCE_FACT = modevaFact({
  factSlug: "province",
  factType: "location",
  fieldPath: "location.province",
  source: MODEVA_CANONICAL_SEED_SOURCE,
  dataset: MODEVA_DATASETS.canonicalSeed,
  rawValue: "Phuket",
  confidence: "medium",
  locatorDetail: "location_seed CTE — province 'Phuket'",
  excerpt: "'Phuket',",
});

/** District as the canonical seed states it. */
export const MODEVA_DISTRICT_FACT = modevaFact({
  factSlug: "district",
  factType: "location",
  fieldPath: "location.district",
  source: MODEVA_CANONICAL_SEED_SOURCE,
  dataset: MODEVA_DATASETS.canonicalSeed,
  rawValue: "Thalang",
  confidence: "medium",
  locatorDetail: "location_seed CTE — district 'Thalang'",
  excerpt: "'Thalang',",
});

/**
 * Country as the canonical seed states it — twice (developer country and
 * location country). Unlike Coralina, Modeva's committed artifacts DO state
 * the country; the same field is a SOURCE_PENDING import blocker there.
 */
export const MODEVA_COUNTRY_FACT = modevaFact({
  factSlug: "country",
  factType: "location",
  fieldPath: "location.country",
  source: MODEVA_CANONICAL_SEED_SOURCE,
  dataset: MODEVA_DATASETS.canonicalSeed,
  rawValue: "Thailand",
  confidence: "medium",
  locatorDetail: "developer_seed and location_seed CTEs — country 'Thailand'",
  excerpt: "'Thailand',",
});

/** Address as the canonical seed states it. */
export const MODEVA_ADDRESS_FACT = modevaFact({
  factSlug: "address",
  factType: "location",
  fieldPath: "location.address",
  source: MODEVA_CANONICAL_SEED_SOURCE,
  dataset: MODEVA_DATASETS.canonicalSeed,
  rawValue: "Bang Tao, Phuket, Thailand",
  confidence: "medium",
  locatorDetail: "INSERT INTO public.projects VALUES — address",
  excerpt: "'Bang Tao, Phuket, Thailand',",
});

/** Tenure as the canonical seed states it. */
export const MODEVA_OWNERSHIP_FACT = modevaFact({
  factSlug: "ownership-type",
  factType: "ownership_type",
  fieldPath: "legal.ownershipType",
  source: MODEVA_CANONICAL_SEED_SOURCE,
  dataset: MODEVA_DATASETS.canonicalSeed,
  rawValue: "Freehold",
  confidence: "medium",
  locatorDetail: "INSERT INTO public.projects VALUES — ownership_type",
  excerpt: "'Freehold',",
});

/** Construction status as the canonical seed states it. */
export const MODEVA_CONSTRUCTION_STATUS_FACT = modevaFact({
  factSlug: "construction-status",
  factType: "construction_status",
  fieldPath: "construction.status",
  source: MODEVA_CANONICAL_SEED_SOURCE,
  dataset: MODEVA_DATASETS.canonicalSeed,
  rawValue: "Planning",
  confidence: "medium",
  locatorDetail: "INSERT INTO public.projects VALUES — construction_status",
  excerpt: "'Planning',",
});

/** Buildings A–G as the price-list import migration states them. */
export const MODEVA_BUILDINGS_FACT = modevaFact({
  factSlug: "buildings",
  factType: "inventory",
  fieldPath: "units.buildings",
  source: MODEVA_PRICE_LIST_IMPORT_SOURCE,
  dataset: MODEVA_DATASETS.priceListImport,
  structuredValue: [...MODEVA_BUILDINGS],
  confidence: "high",
  locatorDetail:
    "building_source VALUES — buildings A–G with stated unit counts 56, 8, 38, 71, 18, 76, 22",
  excerpt: "('A', 'Building A', 1, 56), … ('G', 'Building G', 7, 22)",
});

/** Unit-type vocabulary as the price-list import migration's 289 rows state it. */
export const MODEVA_UNIT_TYPES_FACT = modevaFact({
  factSlug: "unit-types",
  factType: "unit_type",
  fieldPath: "units.unitTypes",
  source: MODEVA_PRICE_LIST_IMPORT_SOURCE,
  dataset: MODEVA_DATASETS.priceListImport,
  structuredValue: [...MODEVA_UNIT_TYPE_LABELS],
  confidence: "high",
  locatorDetail: "distinct unit_type values across the 289 unit_source rows",
  excerpt: MODEVA_UNIT_TYPE_LABELS.join("; "),
});

/** Total unit count as the real-run report records it (observed against the database). */
export const MODEVA_TOTAL_UNITS_FACT = modevaFact({
  factSlug: "total-units",
  factType: "inventory",
  fieldPath: "units.totalUnits",
  source: MODEVA_REAL_RUN_REPORT_SOURCE,
  dataset: MODEVA_DATASETS.realRunReport,
  rawValue: "289",
  confidence: "high",
  locatorDetail: 'Before/After Counts — "units": 289; Import summary — Units: 289',
  excerpt: '"units": 289,',
});

/**
 * Price currency as the price-list import migration states it — in its
 * header ("Import policy: THB currency") and in every row's metadata
 * (`"currency": "THB"`). Unlike Coralina, whose price list states no
 * currency, Modeva's committed import states THB explicitly.
 */
export const MODEVA_CURRENCY_FACT = modevaFact({
  factSlug: "price-currency",
  factType: "currency",
  fieldPath: "pricing.currency",
  source: MODEVA_PRICE_LIST_IMPORT_SOURCE,
  dataset: MODEVA_DATASETS.priceListImport,
  rawValue: "THB",
  confidence: "high",
  locatorDetail: "header import policy and per-row metadata — currency THB",
  excerpt: "-- Import policy: THB currency, 03.07.26 normalized to 2026-07-03",
});

/** Price-list date, raw "03.07.2026" as the embedded artifact's title states it. */
export const MODEVA_PRICE_LIST_DATE_FACT = modevaFact({
  factSlug: "price-list-date",
  factType: "document_date",
  fieldPath: "pricing.priceListDate",
  source: MODEVA_PRICE_LIST_IMPORT_SOURCE,
  dataset: MODEVA_DATASETS.priceListImport,
  rawValue: "03.07.2026",
  structuredValue: "2026-07-03",
  confidence: "high",
  locatorDetail:
    "per-row source_file 'MOB - Price list V.2. - Updated 03.07.2026.pdf'; price_list_date 2026-07-03",
  excerpt: "MOB - Price list V.2. - Updated 03.07.2026.pdf",
});

/** Every Modeva extraction fact this definition states, in declared order. */
export const MODEVA_EXTRACTION_FACTS: readonly ExtractionFact[] = [
  MODEVA_NAME_SEED_FACT,
  MODEVA_NAME_REAL_RUN_FACT,
  MODEVA_PROJECT_TYPE_FACT,
  MODEVA_DEVELOPER_SEED_FACT,
  MODEVA_DEVELOPER_REAL_RUN_FACT,
  MODEVA_AREA_SEED_FACT,
  MODEVA_AREA_REAL_RUN_FACT,
  MODEVA_PROVINCE_FACT,
  MODEVA_DISTRICT_FACT,
  MODEVA_COUNTRY_FACT,
  MODEVA_ADDRESS_FACT,
  MODEVA_OWNERSHIP_FACT,
  MODEVA_CONSTRUCTION_STATUS_FACT,
  MODEVA_BUILDINGS_FACT,
  MODEVA_UNIT_TYPES_FACT,
  MODEVA_TOTAL_UNITS_FACT,
  MODEVA_CURRENCY_FACT,
  MODEVA_PRICE_LIST_DATE_FACT,
];
