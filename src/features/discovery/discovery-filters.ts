import type { Property, PropertyType } from "@/lib/data";
import { ALL_AREAS, deriveAreaOptions, normalizeArea } from "./discovery-areas";
import {
  ALL_COMPLETION_STATUSES,
  COMPLETION_STATUS_LABELS,
  deriveCompletionStatuses,
  toCompletionStatus,
  type CompletionStatus,
} from "./completion-status";

export { ALL_AREAS, ALL_COMPLETION_STATUSES };

export const discoveryTypeOptions = [
  "All types",
  "Villa",
  "Residence",
  "Condominium",
] as const satisfies readonly ("All types" | PropertyType)[];

/** A `<select>` option: the value the filter compares, and what a buyer reads. */
export type DiscoveryOption<T extends string> = { value: T; label: string };

/**
 * Area options for the catalogue actually loaded (F-002).
 *
 * "All areas" always leads, so the reset is present even for an empty
 * catalogue; every other option is backed by at least one project.
 */
export function buildAreaOptions(
  projects: readonly Property[],
): DiscoveryOption<DiscoveryAreaFilter>[] {
  return [
    { value: ALL_AREAS, label: ALL_AREAS },
    ...deriveAreaOptions(projects.map((project) => project.location)).map((area) => ({
      value: area,
      label: area,
    })),
  ];
}

/**
 * Completion options for the catalogue actually loaded (F-001).
 *
 * Only statuses some project genuinely holds are offered, so no option can
 * return the empty state. Projects whose stored status is unrecognised
 * contribute no option but remain visible under "All statuses".
 */
export function buildCompletionOptions(
  projects: readonly Property[],
): DiscoveryOption<DiscoveryCompletionFilter>[] {
  return [
    { value: ALL_COMPLETION_STATUSES, label: ALL_COMPLETION_STATUSES },
    ...deriveCompletionStatuses(projects.map((project) => project.constructionStatus)).map(
      (status) => ({ value: status, label: COMPLETION_STATUS_LABELS[status] }),
    ),
  ];
}

export const discoveryBeachOptions = [
  "Any distance",
  "Beachfront",
  "Under 500 m",
  "Under 1 km",
  "Under 2 km",
] as const;

/**
 * FOREVER-TRUTH-001A: sorting is neutral. The earlier "Forever Recommended"
 * default and "Forever Score high to low" ranked projects by the legacy
 * `foreverVerified` / `trustScore` / `investmentValue` scalars, which carry
 * no evidence contract — a ranking presented as a recommendation must not be
 * derived from unproven values. Catalogue order (the service's stable
 * featured-first, oldest-first order), name, and recorded price are the only
 * public sort keys; missing prices always sort last.
 */
export const discoverySortOptions = [
  "Catalogue order",
  "Name A to Z",
  "Price low to high",
  "Price high to low",
] as const;

/** Either the reset option, or an area label taken from the catalogue itself. */
export type DiscoveryAreaFilter = typeof ALL_AREAS | (string & {});
export type DiscoveryTypeFilter = (typeof discoveryTypeOptions)[number];
export type DiscoveryCompletionFilter = typeof ALL_COMPLETION_STATUSES | CompletionStatus;
export type DiscoveryBeachFilter = (typeof discoveryBeachOptions)[number];
export type DiscoverySortOption = (typeof discoverySortOptions)[number];

export type DiscoveryFilterState = {
  search: string;
  sortBy: DiscoverySortOption;
  budget: string;
  area: DiscoveryAreaFilter;
  propertyType: DiscoveryTypeFilter;
  completionStatus: DiscoveryCompletionFilter;
  beachDistance: DiscoveryBeachFilter;
};

function parseMoneyToTHB(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  const match = normalized.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  if (normalized.includes("m") || normalized.includes("million")) {
    return amount * 1_000_000;
  }

  if (amount > 0 && amount < 1_000) {
    return amount * 1_000_000;
  }

  return amount;
}

function getProjectStartingPriceTHB(project: Property): number | null {
  if (Number.isFinite(project.startingPriceTHB) && project.startingPriceTHB > 0) {
    return project.startingPriceTHB;
  }

  return parseMoneyToTHB(project.price);
}

function parseBeachDistanceMeters(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("beachfront")) return 0;

  const kmMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(km|kilometer|kilometre)/);
  if (kmMatch) return Number(kmMatch[1]) * 1_000;

  const meterMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(m|meter|metre)/);
  if (meterMatch) return Number(meterMatch[1]);

  return null;
}

function matchesBudget(project: Property, budget: string): boolean {
  const maxBudget = parseMoneyToTHB(budget);
  if (maxBudget === null) return true;

  const startingPrice = getProjectStartingPriceTHB(project);
  if (startingPrice === null) return false;

  return startingPrice <= maxBudget;
}

function matchesArea(project: Property, area: DiscoveryAreaFilter): boolean {
  if (area === ALL_AREAS) return true;
  // Normalised on both sides: a casing or spacing difference in the record must
  // not hide a project from its own area (F-002).
  return normalizeArea(project.location) === normalizeArea(area);
}

function matchesPropertyType(project: Property, propertyType: DiscoveryTypeFilter): boolean {
  return propertyType === "All types" || project.propertyType === propertyType;
}

function matchesCompletionStatus(
  project: Property,
  completionStatus: DiscoveryCompletionFilter,
): boolean {
  if (completionStatus === ALL_COMPLETION_STATUSES) return true;
  // Both sides folded to the canonical model (F-001). A project whose stored
  // status is unrecognised resolves to null and answers no specific status —
  // it stays reachable under "All statuses" rather than being filed under a
  // build stage its record never stated.
  return toCompletionStatus(project.constructionStatus) === completionStatus;
}

function matchesBeachDistance(project: Property, beachDistance: DiscoveryBeachFilter): boolean {
  if (beachDistance === "Any distance") return true;

  const meters = parseBeachDistanceMeters(project.distanceToBeach);
  if (meters === null) return false;

  switch (beachDistance) {
    case "Beachfront":
      return meters <= 50;
    case "Under 500 m":
      return meters <= 500;
    case "Under 1 km":
      return meters <= 1_000;
    case "Under 2 km":
      return meters <= 2_000;
    default:
      return true;
  }
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function matchesSearch(project: Property, search: string): boolean {
  const query = normalizeSearchValue(search);
  if (!query) return true;

  return [project.name, project.location, project.developer, project.propertyType]
    .map(normalizeSearchValue)
    .some((value) => value.includes(query));
}

function compareNullableNumbers(
  a: number | null,
  b: number | null,
  direction: "asc" | "desc",
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  return direction === "asc" ? a - b : b - a;
}

function sortDiscoveryProjects(projects: Property[], sortBy: DiscoverySortOption): Property[] {
  switch (sortBy) {
    case "Name A to Z":
      return [...projects].sort((a, b) => a.name.localeCompare(b.name));
    case "Price low to high":
      return [...projects].sort((a, b) =>
        compareNullableNumbers(getProjectStartingPriceTHB(a), getProjectStartingPriceTHB(b), "asc"),
      );
    case "Price high to low":
      return [...projects].sort((a, b) =>
        compareNullableNumbers(
          getProjectStartingPriceTHB(a),
          getProjectStartingPriceTHB(b),
          "desc",
        ),
      );
    case "Catalogue order":
    default:
      // The catalogue's own stable order, exactly as the service returned it.
      return [...projects];
  }
}

export function filterDiscoveryProjects(
  projects: Property[],
  filters: DiscoveryFilterState,
): Property[] {
  const filtered = projects.filter(
    (project) =>
      matchesSearch(project, filters.search) &&
      matchesBudget(project, filters.budget) &&
      matchesArea(project, filters.area) &&
      matchesPropertyType(project, filters.propertyType) &&
      matchesCompletionStatus(project, filters.completionStatus) &&
      matchesBeachDistance(project, filters.beachDistance),
  );

  return sortDiscoveryProjects(filtered, filters.sortBy);
}
