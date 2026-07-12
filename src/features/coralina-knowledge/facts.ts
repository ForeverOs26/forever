/**
 * Coralina extraction facts, stated through the RC4.5 Extraction Pipeline model.
 *
 * Every fact below is a verbatim transcription of committed Coralina data —
 * either the verified fact constants in
 * `src/features/coralina-integration/data/coralina-facts.ts` (imported
 * directly, so the values cannot drift) or the extracted datasets under
 * `forever-data/projects/coralina/extracted/`. Confidence levels are the
 * levels the committed extraction recorded; no score is invented.
 *
 * The CRITICAL ANTI-FABRICATION RULE governs this module:
 *
 * - a value the sources do not state gets NO fact — it is listed in
 *   {@link CORALINA_EXPECTED_MISSING_PATHS} instead, so RC4.7 reports it as
 *   `missing_information` rather than this module inventing it;
 * - where two sources genuinely disagree (the price list and the unit-plan
 *   images state different unit-type vocabularies), BOTH statements are kept
 *   verbatim so RC4.7 can judge the subject contested — nothing is resolved
 *   silently.
 */

import {
  CORALINA_AREA,
  CORALINA_AREA_DETAIL,
  CORALINA_BEACH_DISTANCE,
  CORALINA_BUILDINGS,
  CORALINA_HIGHLIGHTS,
  CORALINA_PRICE_LIST_DATE,
  CORALINA_PROJECT_NAME,
  CORALINA_PROJECT_TYPE,
  CORALINA_PROVINCE,
  CORALINA_UNIT_TYPES,
  type CoralinaFact,
} from "@/features/coralina-integration";
import {
  describeExtractionFact,
  extractionConfidence,
  extractionLocator,
  extractionMethod,
  isKnownExtractionConfidenceLevel,
  type ExtractionConfidenceLevel,
  type ExtractionFact,
  type ExtractionFactType,
  type ExtractionLocator,
  type ExtractionStructuredValue,
} from "@/features/forever-extraction-pipeline";
import type { ProjectKnowledgeGap } from "@/features/forever-project-knowledge";
import type { ProjectSourceDefinition } from "@/features/forever-project-sources";

import { CORALINA_DATASETS, CORALINA_KNOWLEDGE_EXTRACTED_AT, CORALINA_SLUG } from "./identity";
import {
  CORALINA_BROCHURE_SOURCE,
  CORALINA_FACILITIES_SOURCE,
  CORALINA_LOCATION_MAP_SOURCE,
  CORALINA_MASTER_PLAN_SOURCE,
  CORALINA_PRICE_LIST_SOURCE,
  CORALINA_UNIT_PLANS_SOURCE,
} from "./sources";

/**
 * Unit-type labels exactly as the committed unit-plans dataset states them
 * (`extracted/unit-plans.json` → `extracted_unit_type_labels`). These
 * genuinely differ from the price list's vocabulary — the floor plans include
 * a "1 Bedroom S" the price list never mentions and name the penthouses
 * differently — and the disagreement is preserved, not resolved.
 */
export const CORALINA_UNIT_PLAN_TYPE_LABELS: readonly string[] = [
  "1 Bedroom L",
  "1 Bedroom M",
  "1 Bedroom Plus",
  "1 Bedroom S",
  "2 Bedroom",
  "2 Bedroom Plus",
  "Penthouse",
];

/**
 * A canonical field path Coralina's sources genuinely do not address — the
 * engine's shared gap shape, aliased (RC5.1) so the two declarations cannot
 * drift. For Coralina, `manifestBlocker` marks the fields the committed
 * manifest records as SOURCE_PENDING; the readiness profile derives its
 * required gap statements from that flag.
 */
export type CoralinaKnowledgeGap = ProjectKnowledgeGap;

/**
 * The field paths Coralina's committed sources do NOT state, with the reason
 * recorded by the committed manifest / extraction package. RC4.7 receives
 * these as `expectedPaths`, so each one surfaces as an explicit
 * `missing_information` finding instead of a fabricated value.
 */
export const CORALINA_EXPECTED_MISSING_PATHS: readonly CoralinaKnowledgeGap[] = [
  {
    path: "developer.name",
    reason:
      "manifest: developer is SOURCE_PENDING — local sources show The Title / AssetWise / Rhom Bho branding but no Coralina-specific developer statement",
    manifestBlocker: true,
  },
  {
    path: "location.country",
    reason:
      "manifest: country is SOURCE_PENDING — sources identify Kamala and Phuket but never state the country",
    manifestBlocker: true,
  },
  {
    path: "location.coordinates",
    reason: "no GPS coordinates appear in any committed extracted dataset",
  },
  {
    path: "construction.status",
    reason: "no Coralina-specific construction status or completion date in any source",
  },
  {
    path: "legal.ownershipType",
    reason: "freehold vs leasehold tenure is not stated by any source",
  },
  {
    path: "pricing.currency",
    reason: "the price list states figures but no currency; the extracted currency is null",
  },
];

/** Map a committed confidence label onto the RC4.5 vocabulary without inventing certainty. */
function coralinaConfidenceLevel(recorded: string): ExtractionConfidenceLevel {
  return isKnownExtractionConfidenceLevel(recorded) ? recorded : "unknown";
}

interface CoralinaFactSpec {
  factSlug: string;
  factType: ExtractionFactType;
  fieldPath: string;
  source: ProjectSourceDefinition;
  /** Committed dataset the value is transcribed from (cited in provenance). */
  dataset: string;
  rawValue?: string;
  structuredValue?: ExtractionStructuredValue;
  /** Confidence exactly as the committed extraction recorded it. */
  confidence: string;
  /** 1-based page when the committed extraction recorded one. */
  page?: number;
  locatorDetail?: string;
  excerpt?: string;
}

function coralinaFact(spec: CoralinaFactSpec): ExtractionFact {
  const locator: ExtractionLocator =
    spec.page === undefined
      ? extractionLocator("document", { detail: spec.locatorDetail })
      : extractionLocator("page", { page: spec.page, detail: spec.locatorDetail });
  return describeExtractionFact({
    projectSlug: CORALINA_SLUG,
    factSlug: spec.factSlug,
    factType: spec.factType,
    sourceId: spec.source.identity.id,
    sourceVersion: spec.source.version,
    method: extractionMethod("manual", {
      tool: spec.dataset,
      description: "Transcribed verbatim from committed Coralina data; nothing inferred.",
    }),
    extractedAt: CORALINA_KNOWLEDGE_EXTRACTED_AT,
    fieldPath: spec.fieldPath,
    rawValue: spec.rawValue,
    structuredValue: spec.structuredValue,
    confidence: extractionConfidence(coralinaConfidenceLevel(spec.confidence)),
    locator,
    excerpt: spec.excerpt,
  });
}

/** Verified project name (brochure p.12). */
export const CORALINA_NAME_FACT = coralinaFact({
  factSlug: "project-name",
  factType: "project_name",
  fieldPath: "general.name",
  source: CORALINA_BROCHURE_SOURCE,
  dataset: CORALINA_DATASETS.verifiedFacts,
  rawValue: CORALINA_PROJECT_NAME.value,
  confidence: CORALINA_PROJECT_NAME.confidence,
  page: CORALINA_PROJECT_NAME.page ?? undefined,
  excerpt: CORALINA_PROJECT_NAME.value,
});

/** Verified project type (facilities document p.2). */
export const CORALINA_PROJECT_TYPE_FACT = coralinaFact({
  factSlug: "project-type",
  factType: "property_type",
  fieldPath: "general.projectType",
  source: CORALINA_FACILITIES_SOURCE,
  dataset: CORALINA_DATASETS.verifiedFacts,
  rawValue: CORALINA_PROJECT_TYPE.value,
  confidence: CORALINA_PROJECT_TYPE.confidence,
  page: CORALINA_PROJECT_TYPE.page ?? undefined,
  excerpt: CORALINA_PROJECT_TYPE.value,
});

/** Verified primary area (brochure p.1). */
export const CORALINA_AREA_FACT = coralinaFact({
  factSlug: "area",
  factType: "location",
  fieldPath: "location.area",
  source: CORALINA_BROCHURE_SOURCE,
  dataset: CORALINA_DATASETS.verifiedFacts,
  rawValue: CORALINA_AREA.value,
  confidence: CORALINA_AREA.confidence,
  page: CORALINA_AREA.page ?? undefined,
  excerpt: CORALINA_AREA.value,
});

/** Verified province (brochure p.4). */
export const CORALINA_PROVINCE_FACT = coralinaFact({
  factSlug: "province",
  factType: "location",
  fieldPath: "location.province",
  source: CORALINA_BROCHURE_SOURCE,
  dataset: CORALINA_DATASETS.verifiedFacts,
  rawValue: CORALINA_PROVINCE.value,
  confidence: CORALINA_PROVINCE.confidence,
  page: CORALINA_PROVINCE.page ?? undefined,
  excerpt: CORALINA_PROVINCE.value,
});

/** Verified area detail (location map image; no page). */
export const CORALINA_AREA_DETAIL_FACT = coralinaFact({
  factSlug: "area-detail",
  factType: "location",
  fieldPath: "location.areaDetail",
  source: CORALINA_LOCATION_MAP_SOURCE,
  dataset: CORALINA_DATASETS.verifiedFacts,
  rawValue: CORALINA_AREA_DETAIL.value,
  confidence: CORALINA_AREA_DETAIL.confidence,
  locatorDetail: "9. Map__CORALINA Map 2.jpeg",
  excerpt: CORALINA_AREA_DETAIL.value,
});

/** Verified beach distance (brochure p.5). */
export const CORALINA_BEACH_DISTANCE_FACT = coralinaFact({
  factSlug: "beach-distance",
  factType: "location",
  fieldPath: "location.beachDistance",
  source: CORALINA_BROCHURE_SOURCE,
  dataset: CORALINA_DATASETS.verifiedFacts,
  rawValue: CORALINA_BEACH_DISTANCE.value,
  confidence: CORALINA_BEACH_DISTANCE.confidence,
  page: CORALINA_BEACH_DISTANCE.page ?? undefined,
  excerpt: CORALINA_BEACH_DISTANCE.value,
});

/**
 * Buildings A–H as the facilities document states them (p.2). The identical
 * list is independently stated by the unit-plan images, so this subject is a
 * genuine cross-source corroboration.
 *
 * Declaration order is deliberate: this document statement is listed first,
 * so the RC4.6 merge settles the canonical field on it (with its own
 * "medium" confidence — never upgraded by agreement) and records the
 * unit-plans reading as the agreeing duplicate. The corroboration itself is
 * carried by the RC4.7 assessment and the RC4.8 claim, not by the field.
 */
export const CORALINA_BUILDINGS_FACILITIES_FACT = coralinaFact({
  factSlug: "buildings-facilities",
  factType: "inventory",
  fieldPath: "units.buildings",
  source: CORALINA_FACILITIES_SOURCE,
  dataset: CORALINA_DATASETS.brochure,
  structuredValue: [...CORALINA_BUILDINGS],
  confidence: "medium",
  page: 2,
  excerpt:
    "Buildings A, B, C, D, E, F, G, H identified in facilities/project layout and price list",
});

/** Buildings A–H as the unit-plan image collection independently states them. */
export const CORALINA_BUILDINGS_UNIT_PLANS_FACT = coralinaFact({
  factSlug: "buildings-unit-plans",
  factType: "inventory",
  fieldPath: "units.buildings",
  source: CORALINA_UNIT_PLANS_SOURCE,
  dataset: CORALINA_DATASETS.unitPlans,
  structuredValue: [...CORALINA_BUILDINGS],
  confidence: "high",
  locatorDetail:
    "unit-plans dataset extracted_building_labels (from the collection's floor-plan files)",
  excerpt: CORALINA_BUILDINGS.join("; "),
});

/** Unit-type vocabulary as the price list states it. */
export const CORALINA_UNIT_TYPES_PRICE_LIST_FACT = coralinaFact({
  factSlug: "unit-types-price-list",
  factType: "unit_type",
  fieldPath: "units.unitTypes",
  source: CORALINA_PRICE_LIST_SOURCE,
  dataset: CORALINA_DATASETS.priceList,
  structuredValue: [...CORALINA_UNIT_TYPES],
  confidence: "high",
  locatorDetail: "distinct unit_type values across the 198 price-list rows",
  excerpt: CORALINA_UNIT_TYPES.join("; "),
});

/**
 * Unit-type vocabulary as the unit-plan images state it — genuinely different
 * from the price list (includes "1 Bedroom S"; names penthouses differently).
 * Kept verbatim so the disagreement stays visible.
 */
export const CORALINA_UNIT_TYPES_UNIT_PLANS_FACT = coralinaFact({
  factSlug: "unit-types-unit-plans",
  factType: "unit_type",
  fieldPath: "units.unitTypes",
  source: CORALINA_UNIT_PLANS_SOURCE,
  dataset: CORALINA_DATASETS.unitPlans,
  structuredValue: [...CORALINA_UNIT_PLAN_TYPE_LABELS],
  confidence: "high",
  locatorDetail:
    "unit-plans dataset extracted_unit_type_labels (from the collection's unit-plan files)",
  excerpt: CORALINA_UNIT_PLAN_TYPE_LABELS.join("; "),
});

/** Price-list date, raw "03.07.26" normalised by the committed extraction. */
export const CORALINA_PRICE_LIST_DATE_FACT = coralinaFact({
  factSlug: "price-list-date",
  factType: "document_date",
  fieldPath: "pricing.priceListDate",
  source: CORALINA_PRICE_LIST_SOURCE,
  dataset: CORALINA_DATASETS.priceList,
  rawValue: "03.07.26",
  structuredValue: CORALINA_PRICE_LIST_DATE,
  confidence: "high",
  page: 1,
  excerpt: "03.07.26",
});

/**
 * Master-plan drawing date as the committed extraction recorded it
 * (`masterplan.json` → `extracted_fields.plan_date`, confidence medium).
 *
 * The observed statement is the dated render's own filename — the artifact's
 * only textual date — so the excerpt quotes that filename fragment, framed by
 * the locator as exactly that. The same evidence backs the registered
 * master-plan source's `documentDate`, keeping fact and source consistent.
 */
export const CORALINA_MASTER_PLAN_DATE_FACT = coralinaFact({
  factSlug: "master-plan-date",
  factType: "document_date",
  fieldPath: "documents.masterPlanDate",
  source: CORALINA_MASTER_PLAN_SOURCE,
  dataset: CORALINA_DATASETS.masterplan,
  structuredValue: "2025-10-09",
  confidence: "medium",
  locatorDetail:
    "filename of the dated render: 4. Master Plan__JPG__20251009_Coralina_Master Plan-01.jpg",
  excerpt: "20251009_Coralina_Master Plan-01",
});

/**
 * Select a committed highlight by its exact verbatim value — never by array
 * position, so a reordering or edit of the upstream constants can never
 * silently attach the wrong value or provenance to a fact. A missing
 * highlight fails loudly at module load instead of fabricating.
 */
function coralinaHighlight(value: string): CoralinaFact {
  const highlight = CORALINA_HIGHLIGHTS.find((candidate) => candidate.value === value);
  if (!highlight) {
    throw new Error(`Coralina knowledge: verified highlight not found: "${value}"`);
  }
  return highlight;
}

const OUTDOOR_FACILITIES_HIGHLIGHT = coralinaHighlight("12 outdoor facilities");
const INDOOR_FACILITIES_HIGHLIGHT = coralinaHighlight("10 indoor facilities");
const GREEN_SPACE_HIGHLIGHT = coralinaHighlight(
  "2,900 sq.m. green space: reduce heat & refresh air quality",
);
const POOLS_HIGHLIGHT = coralinaHighlight("2,500 sq.m. pools: lap, lagoon, kids pool");
const PET_FRIENDLY_HIGHLIGHT = coralinaHighlight("Pet friendly");

/** Verified amenity highlights, verbatim from the committed verified facts. */
export const CORALINA_OUTDOOR_FACILITIES_FACT = coralinaFact({
  factSlug: "outdoor-facilities",
  factType: "amenity",
  fieldPath: "amenities.outdoorFacilities",
  source: CORALINA_BROCHURE_SOURCE,
  dataset: CORALINA_DATASETS.verifiedFacts,
  rawValue: OUTDOOR_FACILITIES_HIGHLIGHT.value,
  confidence: OUTDOOR_FACILITIES_HIGHLIGHT.confidence,
  page: OUTDOOR_FACILITIES_HIGHLIGHT.page ?? undefined,
  excerpt: OUTDOOR_FACILITIES_HIGHLIGHT.value,
});

export const CORALINA_INDOOR_FACILITIES_FACT = coralinaFact({
  factSlug: "indoor-facilities",
  factType: "amenity",
  fieldPath: "amenities.indoorFacilities",
  source: CORALINA_BROCHURE_SOURCE,
  dataset: CORALINA_DATASETS.verifiedFacts,
  rawValue: INDOOR_FACILITIES_HIGHLIGHT.value,
  confidence: INDOOR_FACILITIES_HIGHLIGHT.confidence,
  page: INDOOR_FACILITIES_HIGHLIGHT.page ?? undefined,
  excerpt: INDOOR_FACILITIES_HIGHLIGHT.value,
});

export const CORALINA_GREEN_SPACE_FACT = coralinaFact({
  factSlug: "green-space",
  factType: "amenity",
  fieldPath: "amenities.greenSpace",
  source: CORALINA_BROCHURE_SOURCE,
  dataset: CORALINA_DATASETS.verifiedFacts,
  rawValue: GREEN_SPACE_HIGHLIGHT.value,
  confidence: GREEN_SPACE_HIGHLIGHT.confidence,
  page: GREEN_SPACE_HIGHLIGHT.page ?? undefined,
  excerpt: GREEN_SPACE_HIGHLIGHT.value,
});

export const CORALINA_POOLS_FACT = coralinaFact({
  factSlug: "pools",
  factType: "amenity",
  fieldPath: "amenities.pools",
  source: CORALINA_BROCHURE_SOURCE,
  dataset: CORALINA_DATASETS.verifiedFacts,
  rawValue: POOLS_HIGHLIGHT.value,
  confidence: POOLS_HIGHLIGHT.confidence,
  page: POOLS_HIGHLIGHT.page ?? undefined,
  excerpt: POOLS_HIGHLIGHT.value,
});

export const CORALINA_PET_FRIENDLY_FACT = coralinaFact({
  factSlug: "pet-friendly",
  factType: "amenity",
  fieldPath: "amenities.petFriendly",
  source: CORALINA_FACILITIES_SOURCE,
  dataset: CORALINA_DATASETS.verifiedFacts,
  rawValue: PET_FRIENDLY_HIGHLIGHT.value,
  confidence: PET_FRIENDLY_HIGHLIGHT.confidence,
  page: PET_FRIENDLY_HIGHLIGHT.page ?? undefined,
  excerpt: PET_FRIENDLY_HIGHLIGHT.value,
});

/** Every Coralina extraction fact this slice states, in declared order. */
export const CORALINA_EXTRACTION_FACTS: readonly ExtractionFact[] = [
  CORALINA_NAME_FACT,
  CORALINA_PROJECT_TYPE_FACT,
  CORALINA_AREA_FACT,
  CORALINA_PROVINCE_FACT,
  CORALINA_AREA_DETAIL_FACT,
  CORALINA_BEACH_DISTANCE_FACT,
  CORALINA_BUILDINGS_FACILITIES_FACT,
  CORALINA_BUILDINGS_UNIT_PLANS_FACT,
  CORALINA_UNIT_TYPES_PRICE_LIST_FACT,
  CORALINA_UNIT_TYPES_UNIT_PLANS_FACT,
  CORALINA_PRICE_LIST_DATE_FACT,
  CORALINA_MASTER_PLAN_DATE_FACT,
  CORALINA_OUTDOOR_FACILITIES_FACT,
  CORALINA_INDOOR_FACILITIES_FACT,
  CORALINA_GREEN_SPACE_FACT,
  CORALINA_POOLS_FACT,
  CORALINA_PET_FRIENDLY_FACT,
];
