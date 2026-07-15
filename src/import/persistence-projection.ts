import type { BuildingInput, PriceHistoryInput, UnitInput } from "./database";

/**
 * Canonical persistence projections shared by the write path (`database.ts`)
 * and the RC5.5B read-only collision inspector.
 *
 * Each `*PersistenceProjection` returns exactly the STABLE fields the current
 * write path persists, excluding only genuinely volatile runtime values
 * (`updated_at`, runtime `last_data_review_at`). The write path spreads these
 * projections and adds the volatile fields on top, so extracting them changes
 * no write behavior and enables no write. The inspector compares the same
 * projection against the target row so a partial comparison can never be
 * mislabeled `exact_match`.
 */

/** Minimal manifest shape needed to project a project row. */
export interface ProjectManifestFields {
  project_slug: string;
  project_name: string;
  project_type: string;
  developer: string;
  country: string;
  province: string;
  location: string;
}

export interface ProjectForeignKeys {
  developerId: string;
  locationId: string;
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Natural key (slug) the write path uses for the developer dependency. */
export function developerNaturalKey(manifest: Pick<ProjectManifestFields, "developer">): string {
  return slugify(manifest.developer);
}

/** Natural key (slug) the write path uses for the location dependency. */
export function locationNaturalKey(manifest: Pick<ProjectManifestFields, "location">): string {
  return slugify(manifest.location);
}

/** Stable persisted project fields (mirrors `database.ts` `upsertProject`). */
export function projectPersistenceProjection(
  manifest: ProjectManifestFields,
  keys: ProjectForeignKeys,
) {
  return {
    slug: manifest.project_slug,
    name: manifest.project_name,
    developer_id: keys.developerId,
    location_id: keys.locationId,
    project_code: manifest.project_slug.toUpperCase(),
    project_type: manifest.project_type,
    location_area: manifest.location,
    address: `${manifest.location}, ${manifest.province}, ${manifest.country}`,
    short_description: `${manifest.project_name} imported from Forever source materials.`,
    full_description: `${manifest.project_name} imported from Forever source materials.`,
    is_active: true,
    public_status: "published",
    sales_status: "Available",
  };
}

/** Stable persisted building fields (mirrors `database.ts` `upsertBuildings`). */
export function buildingPersistenceProjection(projectId: string, building: BuildingInput) {
  return {
    project_id: projectId,
    name: building.name,
    building_code: building.buildingCode,
    building_type: "residential",
    floors_count: building.floorsCount ?? null,
    units_count: building.unitsCount ?? null,
    metadata: building.metadata ?? {},
  };
}

/**
 * Stable persisted unit fields (mirrors `database.ts` `upsertUnits`).
 *
 * `buildingId` accepts `string | null | undefined` and is passed through
 * verbatim: `undefined` (an unresolved building code) omits `building_id` from
 * the persisted payload, while `null` explicitly clears it. Preserving that
 * distinction keeps the exact pre-RC5.5B update semantics.
 */
export function unitPersistenceProjection(
  projectId: string,
  buildingId: string | null | undefined,
  unit: UnitInput,
) {
  return {
    project_id: projectId,
    building_id: buildingId,
    unit_code: unit.unitNumber,
    unit_type: unit.unitType ?? null,
    bedrooms: unit.bedrooms ?? null,
    bathrooms: unit.bathrooms ?? null,
    size_sqm: unit.sizeSqm ?? null,
    floor: unit.floor ?? null,
    base_price_thb: unit.currency === "THB" ? (unit.price ?? null) : null,
    price_per_sqm: unit.pricePerSqm ?? null,
    availability_status: unit.availabilityStatus ?? "available",
    unit_status: unit.availabilityStatus ?? "available",
    metadata: {
      source_type_code: unit.sourceTypeCode,
      currency: unit.currency,
      source_file: unit.sourceFile,
      source_page: unit.sourcePage,
      source_row: unit.sourceRow,
      price_list_date: unit.priceListDate,
      raw: unit.raw,
    },
  };
}

/**
 * Stable persisted price-history fields (mirrors
 * `database.ts` `createPriceHistoryPersistencePayload`). `recorded_at` is the
 * stable price-list date, not a runtime timestamp.
 */
export function priceHistoryPersistenceProjection(unitId: string, row: PriceHistoryInput) {
  return {
    unit_id: unitId,
    price: row.price,
    currency: row.currency,
    price_source: row.priceSource,
    source_file: row.sourceFile ?? null,
    source_page: row.sourcePage ?? null,
    price_list_date: row.priceListDate,
    recorded_at: row.recordedDate,
    metadata: {
      source_type_code: row.sourceTypeCode,
      unit_number: row.unitNumber,
      building_code: row.buildingCode,
      floor: row.floor,
      unit_type: row.unitType,
      bedrooms: row.bedrooms,
      size_sqm: row.sizeSqm,
      price_per_sqm: row.pricePerSqm,
      availability_status: row.availabilityStatus,
      source_row: row.sourceRow,
      raw: row.raw,
      currency_decision: row.currencyDecision,
    },
  };
}

/**
 * Deterministic canonical form for JSON/metadata comparison: recursively drops
 * `undefined`, sorts object keys, and preserves array order. Independent of
 * object key insertion order.
 */
export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalJson(entry)]),
  );
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalJson(value));
}

/**
 * Deterministic database dedupe key for a price-history row, mirroring the
 * unique index `(unit_id, price_source, source_file, source_page,
 * price_list_date)`. `sourceRow` is intentionally NOT part of the persistence
 * key. `unitIdentity` is the resolved unit id at read time, or the plan
 * `unitNumber` when checking the plan before any read.
 */
export function pricePersistenceDedupeKey(
  unitIdentity: string,
  row: Pick<PriceHistoryInput, "priceSource" | "sourceFile" | "sourcePage" | "priceListDate">,
): string {
  return JSON.stringify([
    unitIdentity,
    row.priceSource ?? null,
    row.sourceFile ?? null,
    row.sourcePage ?? null,
    row.priceListDate ?? null,
  ]);
}
