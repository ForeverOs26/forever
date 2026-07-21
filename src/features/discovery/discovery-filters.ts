import type { ConstructionStatus, Property, PropertyType } from "@/lib/data";

export const discoveryAreaOptions = [
  "All areas",
  "Surin Beach",
  "Kamala",
  "Layan",
  "Bang Tao",
  "Kata Noi",
  "Rawai",
] as const;

export const discoveryTypeOptions = [
  "All types",
  "Villa",
  "Residence",
  "Condominium",
] as const satisfies readonly ("All types" | PropertyType)[];

export const discoveryCompletionOptions = [
  "Any status",
  "Ready",
  "Nearing Completion",
  "Under Construction",
  "Pre-Launch",
  "Planning",
  "Sold Out",
] as const satisfies readonly ("Any status" | ConstructionStatus)[];

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

export type DiscoveryAreaFilter = (typeof discoveryAreaOptions)[number];
export type DiscoveryTypeFilter = (typeof discoveryTypeOptions)[number];
export type DiscoveryCompletionFilter = (typeof discoveryCompletionOptions)[number];
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
  return area === "All areas" || project.location === area;
}

function matchesPropertyType(project: Property, propertyType: DiscoveryTypeFilter): boolean {
  return propertyType === "All types" || project.propertyType === propertyType;
}

function matchesCompletionStatus(
  project: Property,
  completionStatus: DiscoveryCompletionFilter,
): boolean {
  return completionStatus === "Any status" || project.constructionStatus === completionStatus;
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
