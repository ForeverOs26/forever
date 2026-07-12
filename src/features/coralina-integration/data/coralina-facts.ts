/**
 * Coralina verified project-level facts.
 *
 * Every value here is copied verbatim from the committed Coralina source
 * material under `forever-data/projects/coralina/` (the manifest and the
 * `extracted/*.json` datasets). Nothing is inferred or defaulted.
 *
 * The CRITICAL ANTI-FABRICATION RULE governs this file: a fact that the source
 * does not state is listed in {@link CORALINA_DATA_GAPS} and is never given a
 * placeholder value. In particular the source states NO developer, NO country,
 * NO coordinates, NO construction status, NO ownership type, and NO currency for
 * its prices — so those never appear as asserted facts anywhere in the module.
 */

/** A single verified project-level fact with its source provenance. */
export interface CoralinaFact {
  value: string;
  sourceFile: string;
  /** Source page when the extraction recorded one. */
  page: number | null;
  /** Extraction confidence, verbatim: `high` | `medium` | `low`. */
  confidence: string;
}

const BROCHURE =
  "forever-data/projects/coralina/source/brochure/2. E-Brochure__20251209 Coralina E-brochure.pdf";
const FACILITIES =
  "forever-data/projects/coralina/source/documents/3. Facilities__Coralina Facilities.pdf";
const MAP2 = "forever-data/projects/coralina/source/documents/9. Map__CORALINA Map 2.jpeg";

/** Verified project identity. */
export const CORALINA_PROJECT_NAME: CoralinaFact = {
  value: "CORALINA KAMALA",
  sourceFile: BROCHURE,
  page: 12,
  confidence: "high",
};

/** URL-safe project slug (natural key), derived from the verified name. */
export const CORALINA_PROJECT_SLUG = "coralina";

/** Verified project type. */
export const CORALINA_PROJECT_TYPE: CoralinaFact = {
  value: "Residential",
  sourceFile: FACILITIES,
  page: 2,
  confidence: "medium",
};

/** Verified primary location (area). */
export const CORALINA_AREA: CoralinaFact = {
  value: "Kamala",
  sourceFile: BROCHURE,
  page: 1,
  confidence: "high",
};

/** Verified province. */
export const CORALINA_PROVINCE: CoralinaFact = {
  value: "Phuket",
  sourceFile: BROCHURE,
  page: 4,
  confidence: "high",
};

/** Verified area detail. */
export const CORALINA_AREA_DETAIL: CoralinaFact = {
  value: "Kamala Beach / walk to the beach 430 m.",
  sourceFile: MAP2,
  page: null,
  confidence: "high",
};

/** Verified distance to the beach. */
export const CORALINA_BEACH_DISTANCE: CoralinaFact = {
  value: "Walk to the beach 430 m. / 5 mins",
  sourceFile: BROCHURE,
  page: 5,
  confidence: "high",
};

/** Verified marketing taglines/descriptions, verbatim. */
export const CORALINA_TAGLINE: CoralinaFact = {
  value: "Beauty of the Ocean",
  sourceFile: BROCHURE,
  page: 1,
  confidence: "high",
};

export const CORALINA_DESCRIPTION: CoralinaFact = {
  value:
    "Coralina Kamala blends nature, wellness, service and smart tech for a truly sustainable lifestyle.",
  sourceFile: BROCHURE,
  page: 12,
  confidence: "high",
};

/** Verified project highlights, each copied verbatim from the brochure. */
export const CORALINA_HIGHLIGHTS: readonly CoralinaFact[] = [
  { value: "12 outdoor facilities", sourceFile: BROCHURE, page: 21, confidence: "high" },
  { value: "10 indoor facilities", sourceFile: BROCHURE, page: 21, confidence: "high" },
  {
    value: "2,900 sq.m. green space: reduce heat & refresh air quality",
    sourceFile: BROCHURE,
    page: 12,
    confidence: "high",
  },
  {
    value: "2,500 sq.m. pools: lap, lagoon, kids pool",
    sourceFile: BROCHURE,
    page: 12,
    confidence: "high",
  },
  { value: "Pet friendly", sourceFile: FACILITIES, page: 2, confidence: "high" },
];

/**
 * Verified nearby destinations, verbatim from the brochure. Used as verified
 * location lifestyle context; never treated as a distance-to-airport figure
 * (the source states none).
 */
export const CORALINA_NEARBY_DESTINATIONS: readonly CoralinaFact[] = [
  {
    value: "Sunwing / Sunprime Kamala Beach 300 m.",
    sourceFile: BROCHURE,
    page: 5,
    confidence: "high",
  },
  { value: "Wattanapat Hospital 450 m.", sourceFile: BROCHURE, page: 5, confidence: "high" },
  { value: "Phuket FantaSea 500 m.", sourceFile: BROCHURE, page: 5, confidence: "high" },
  { value: "Big C 1.0 km.", sourceFile: BROCHURE, page: 5, confidence: "high" },
  { value: "Tops 1.1 km.", sourceFile: BROCHURE, page: 5, confidence: "high" },
  { value: "Villa Market 1.2 km.", sourceFile: BROCHURE, page: 5, confidence: "high" },
  { value: "InterCon Hotel 1.4 km.", sourceFile: BROCHURE, page: 5, confidence: "high" },
  {
    value: "Hyatt Regency Phuket Resort 2.5 km.",
    sourceFile: BROCHURE,
    page: 5,
    confidence: "high",
  },
];

/** Verified nearby hospital (subset of nearby destinations), for the Location entity. */
export const CORALINA_NEARBY_HOSPITALS: readonly string[] = ["Wattanapat Hospital 450 m."];

/** Verified buildings, verbatim from the facilities/price-list layout. */
export const CORALINA_BUILDINGS: readonly string[] = ["A", "B", "C", "D", "E", "F", "G", "H"];

/** Verified unit types, verbatim from the price list. */
export const CORALINA_UNIT_TYPES: readonly string[] = [
  "1 BEDROOM L",
  "1 BEDROOM M",
  "1 BEDROOM PLUS",
  "2 BEDROOM",
  "2 BEDROOM PLUS",
  "PH-2 BEDROOM PLUS",
  "PH-3 BEDROOM",
];

/** The brochure document used as the project's primary evidence file. */
export const CORALINA_BROCHURE_SOURCE_FILE = BROCHURE;

/**
 * Coralina data gaps — facts the source material does NOT provide.
 *
 * These are recorded explicitly (per the anti-fabrication rule) so the
 * integration never silently substitutes a value and the verification result
 * can report exactly what is missing. Each entry mirrors a `SOURCE_PENDING` or
 * `null` value in the committed manifest / extraction datasets.
 */
export const CORALINA_DATA_GAPS: readonly string[] = [
  "developer (manifest: SOURCE_PENDING — local sources show The Title / AssetWise / Rhom Bho branding but no Coralina-specific developer statement)",
  "country (manifest: SOURCE_PENDING — sources identify Kamala and Phuket but not the country)",
  "coordinates / latitude / longitude (no GPS values in any extracted dataset)",
  "construction status / completion date (no Coralina-specific value in any source)",
  "ownership type / tenure (freehold vs leasehold not stated)",
  "price currency (price list states figures but no currency; extracted currency is null)",
  "project total unit count as a stated fact (derivable only by counting the price list)",
  "per-unit bathrooms (not recorded in the price list)",
  "payment plan / payment terms (not recorded in the price list)",
  "rental information (no expected rent, occupancy, guarantee, or management figures)",
  "investment information (no ROI, yield, or capital-growth figures)",
  "developer legal entity, website, and contact details",
];
