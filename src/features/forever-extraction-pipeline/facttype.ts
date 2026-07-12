/**
 * Forever Extraction Pipeline — the fact-type vocabulary.
 *
 * The closed vocabulary of structured facts a registered source can produce:
 * the project-level facts (name, developer, location, coordinates), the
 * unit-level facts (type, bedrooms, bathrooms, areas), the commercial facts
 * (price, currency, ownership, payment plan), the delivery facts (completion
 * date, construction status), the plan documents (floor, master, and unit
 * plans), the claims (legal, rental, investment, developer), and the intake
 * facts (document date, availability, inventory). `"unknown"` explicitly
 * represents a fact that cannot yet be classified so it is described rather
 * than dropped (anti-fabrication).
 *
 * These are vocabulary values and pure, total helpers only. RC4.5 never
 * extracts, derives, or normalizes a fact of any of these types — it names
 * what a future runtime could produce, and the declared order gives the whole
 * module one deterministic fact-type ordering.
 */

/** Every fact type a future extraction runtime is described as producing. */
export type ExtractionFactType =
  | "project_name"
  | "developer"
  | "location"
  | "coordinates"
  | "property_type"
  | "unit_type"
  | "bedrooms"
  | "bathrooms"
  | "internal_area"
  | "external_area"
  | "total_area"
  | "land_area"
  | "price"
  | "currency"
  | "price_per_sqm"
  | "ownership_type"
  | "payment_plan"
  | "completion_date"
  | "construction_status"
  | "amenity"
  | "floor_plan"
  | "master_plan"
  | "unit_plan"
  | "legal_statement"
  | "rental_claim"
  | "investment_claim"
  | "developer_claim"
  | "document_date"
  | "availability"
  | "inventory"
  | "unknown";

/**
 * Every classifiable {@link ExtractionFactType}, in the canonical declared
 * order — the deterministic ordering plans and sorted fact lists follow.
 */
export const SUPPORTED_EXTRACTION_FACT_TYPES = [
  "project_name",
  "developer",
  "location",
  "coordinates",
  "property_type",
  "unit_type",
  "bedrooms",
  "bathrooms",
  "internal_area",
  "external_area",
  "total_area",
  "land_area",
  "price",
  "currency",
  "price_per_sqm",
  "ownership_type",
  "payment_plan",
  "completion_date",
  "construction_status",
  "amenity",
  "floor_plan",
  "master_plan",
  "unit_plan",
  "legal_statement",
  "rental_claim",
  "investment_claim",
  "developer_claim",
  "document_date",
  "availability",
  "inventory",
] as const satisfies readonly ExtractionFactType[];

/** Every {@link ExtractionFactType} including the explicit `"unknown"`. */
export const EXTRACTION_FACT_TYPES = [
  ...SUPPORTED_EXTRACTION_FACT_TYPES,
  "unknown",
] as const satisfies readonly ExtractionFactType[];

/** Runtime guard: whether a value is a known {@link ExtractionFactType}. */
export function isKnownExtractionFactType(value: unknown): value is ExtractionFactType {
  return typeof value === "string" && (EXTRACTION_FACT_TYPES as readonly string[]).includes(value);
}

/**
 * Rank of a fact type in the canonical declared order; `"unknown"` ranks
 * last among the vocabulary, and an out-of-vocabulary runtime value ranks
 * after everything so a malformed fact never jumps the deterministic order.
 */
export function extractionFactTypeRank(type: ExtractionFactType): number {
  const rank = (EXTRACTION_FACT_TYPES as readonly ExtractionFactType[]).indexOf(type);
  return rank === -1 ? EXTRACTION_FACT_TYPES.length : rank;
}

/**
 * Comparator ordering fact types by the canonical declared order.
 *
 * Suitable for `Array.prototype.sort`. Pure and total — the one deterministic
 * fact-type ordering the whole module shares.
 */
export function compareExtractionFactType(a: ExtractionFactType, b: ExtractionFactType): number {
  return extractionFactTypeRank(a) - extractionFactTypeRank(b);
}
