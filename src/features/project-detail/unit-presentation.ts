/**
 * Unit presentation — one source of truth for how a unit row is read and shown
 * (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * The unit preview near the top of the page and the full inventory table lower
 * down are two views of the same rows. Extracting the availability test, the
 * formatting and the ordering here is what stops them becoming two answers to
 * the same question: a unit is never "available" in one and "sold" in the
 * other, and a price never rounds differently between them.
 *
 * Nothing here invents a field. A price the public projection does not carry
 * shows as an em dash, not as "price on request".
 */

import type { ProjectDetailUnit } from "./project-detail-types";

/** Statuses that mean "not currently buyable". Anything else reads as available. */
const UNAVAILABLE_STATUSES = new Set(["sold", "sold_out", "reserved", "booked", "blocked"]);

export function isAvailable(unit: ProjectDetailUnit): boolean {
  return !UNAVAILABLE_STATUSES.has(unit.availabilityStatus.trim().toLowerCase());
}

/** Title-case a raw status token for display ("sold_out" -> "Sold out"). */
export function statusLabel(status: string): string {
  const cleaned = status.trim().replace(/[_-]+/g, " ");
  if (!cleaned) return "Not available";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

/**
 * A recorded price, or an explicit dash.
 *
 * Reads only the price columns granted to the anonymous role
 * (`20260723130000_public_projection_privacy.sql`). `unit_price_history` is
 * deliberately NOT public — it carries source paths and provenance — so a unit
 * whose price exists only there shows an em dash rather than leaking that table
 * or inventing a "price on request" claim the record does not support.
 */
export function priceLabel(unit: ProjectDetailUnit): string {
  const price = unit.discountedPriceTHB ?? unit.basePriceTHB;
  if (price === null || price === undefined) return "—";
  const numeric = Number(price);
  if (!Number.isFinite(numeric)) return "—";
  return `฿${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(numeric)}`;
}

export function areaLabel(unit: ProjectDetailUnit): string {
  if (unit.sizeSqm === null || unit.sizeSqm === undefined) return "—";
  const numeric = Number(unit.sizeSqm);
  if (!Number.isFinite(numeric)) return "—";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric)} m²`;
}

/** Numeric price for sorting and ranges, or null when the record has none. */
export function priceValue(unit: ProjectDetailUnit): number | null {
  const price = unit.discountedPriceTHB ?? unit.basePriceTHB;
  if (price === null || price === undefined) return null;
  const numeric = Number(price);
  return Number.isFinite(numeric) ? numeric : null;
}

export function areaValue(unit: ProjectDetailUnit): number | null {
  if (unit.sizeSqm === null || unit.sizeSqm === undefined) return null;
  const numeric = Number(unit.sizeSqm);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Per-unit availability, ordered available-first then by unit code.
 *
 * Rendered from the recorded rows only: a unit the developer marked sold is
 * shown as sold, never folded into the available count. Deterministic order
 * keeps the table stable between loads.
 */
export function unitRows(units: readonly ProjectDetailUnit[]): ProjectDetailUnit[] {
  return [...units].sort((left, right) => {
    const leftAvailable = isAvailable(left);
    const rightAvailable = isAvailable(right);
    if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1;
    return left.code.localeCompare(right.code, "en");
  });
}

/**
 * How the unit list is ordered.
 *
 * `listed-order` is the default: available units first, then unit code. It is
 * named for what it does. The earlier name for it — "recommended" — claimed an
 * endorsement Forever cannot support, because per-unit price currentness is not
 * provable (`units.price_effective_date` does not exist) and nothing in the
 * ordering weighs suitability for a buyer. A neutral name carries no such claim.
 */
export type UnitSort = "listed-order" | "price-asc" | "price-desc" | "area-asc" | "area-desc";

export interface UnitFilterState {
  bedrooms: string;
  building: string;
  type: string;
  includeSold: boolean;
  sort: UnitSort;
}

export const DEFAULT_UNIT_FILTERS: UnitFilterState = {
  bedrooms: "all",
  building: "all",
  type: "all",
  includeSold: false,
  sort: "listed-order",
};

export interface UnitFacet {
  value: string;
  label: string;
  count: number;
}

/**
 * Filter options derived from the loaded inventory.
 *
 * Every option is a value at least one unit actually has, so no choice can
 * return an empty list and no option is hardcoded for a project that does not
 * have it. Counts are over the whole inventory, not the current selection, so
 * the control does not renumber itself as the user narrows it.
 */
export function unitFacets(units: readonly ProjectDetailUnit[]): {
  bedrooms: UnitFacet[];
  buildings: UnitFacet[];
  types: UnitFacet[];
  soldCount: number;
} {
  const bedrooms = new Map<string, number>();
  const buildings = new Map<string, number>();
  const types = new Map<string, number>();
  let soldCount = 0;

  for (const unit of units) {
    if (!isAvailable(unit)) soldCount += 1;
    if (unit.bedrooms !== null && unit.bedrooms !== undefined) {
      const key = String(unit.bedrooms);
      bedrooms.set(key, (bedrooms.get(key) ?? 0) + 1);
    }
    if (unit.buildingCode) {
      buildings.set(unit.buildingCode, (buildings.get(unit.buildingCode) ?? 0) + 1);
    }
    const type = unit.type.trim();
    if (type) types.set(type, (types.get(type) ?? 0) + 1);
  }

  const facets = (source: Map<string, number>, label: (value: string) => string): UnitFacet[] =>
    [...source.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true }))
      .map(([value, count]) => ({ value, label: label(value), count }));

  return {
    bedrooms: facets(bedrooms, (value) => (value === "1" ? "1 bedroom" : `${value} bedrooms`)),
    buildings: facets(buildings, (value) => `Building ${value}`),
    types: facets(types, (value) => value),
    soldCount,
  };
}

/** Apply the filters entirely in memory: the inventory is already loaded. */
export function applyUnitFilters(
  units: readonly ProjectDetailUnit[],
  filters: UnitFilterState,
): ProjectDetailUnit[] {
  const filtered = units.filter((unit) => {
    if (!filters.includeSold && !isAvailable(unit)) return false;
    if (filters.bedrooms !== "all" && String(unit.bedrooms ?? "") !== filters.bedrooms)
      return false;
    if (filters.building !== "all" && (unit.buildingCode ?? "") !== filters.building) return false;
    if (filters.type !== "all" && unit.type.trim() !== filters.type) return false;
    return true;
  });

  if (filters.sort === "listed-order") return unitRows(filtered);

  // A unit with no recorded value sorts last in either direction, so an
  // incomplete record never displaces a priced one from the top of the list.
  const key = filters.sort.startsWith("price") ? priceValue : areaValue;
  const descending = filters.sort.endsWith("desc");
  return [...filtered].sort((left, right) => {
    const a = key(left);
    const b = key(right);
    if (a === null && b === null) return left.code.localeCompare(right.code, "en");
    if (a === null) return 1;
    if (b === null) return -1;
    if (a === b) return left.code.localeCompare(right.code, "en");
    return descending ? b - a : a - b;
  });
}

/** Human range across the inventory, e.g. "30 – 64 m²". Empty when unknown. */
export function unitSizeRange(units: readonly ProjectDetailUnit[]): string {
  const values = units.map(areaValue).filter((value): value is number => value !== null);
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const format = (value: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  return min === max ? `${format(min)} m²` : `${format(min)} – ${format(max)} m²`;
}

/** Distinct building codes present in the inventory, in stable order. */
export function buildingCodes(units: readonly ProjectDetailUnit[]): string[] {
  const codes = new Set<string>();
  for (const unit of units) if (unit.buildingCode) codes.add(unit.buildingCode);
  return [...codes].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}
