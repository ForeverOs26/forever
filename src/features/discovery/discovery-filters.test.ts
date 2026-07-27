import { describe, expect, it } from "vitest";

import type { Property } from "@/lib/data";
import {
  ALL_AREAS,
  ALL_COMPLETION_STATUSES,
  buildAreaOptions,
  buildCompletionOptions,
  discoverySortOptions,
  filterDiscoveryProjects,
  type DiscoveryFilterState,
} from "./discovery-filters";

/**
 * FOREVER-TRUTH-001A regression: public Discovery must not rank or filter on
 * recommendation, score, or verification signals — those classifications have
 * no evidence contract. Only neutral orderings remain: catalogue order, name,
 * and recorded price (missing prices last).
 */

function property(overrides: Partial<Property>): Property {
  return {
    slug: "p",
    name: "P",
    developer: "",
    location: "Kamala",
    propertyType: "Not available",
    constructionStatus: "Not available",
    status: "Not available",
    tagline: "",
    description: "",
    highlights: [],
    beds: "",
    area: "",
    price: "",
    startingPriceTHB: 0,
    priceRange: "",
    pricePerSqm: "",
    lastPriceUpdate: "",
    verifiedPrice: "",
    promotion: "",
    foreverVerified: false,
    trustScore: 0,
    trustNote: "",
    investmentValue: 0,
    marketPosition: "Not available",
    verdict: "Not available",
    distanceToBeach: "",
    distanceToAirport: "",
    nearbySchools: [],
    nearbyHospitals: [],
    lifestyle: [],
    rentalYield: "",
    rentalDemand: "Not available",
    capitalGrowthEstimate: "",
    startDate: "",
    completionDate: "",
    lastInspection: "",
    image: "",
    gallery: [],
    floorPlans: [],
    brochures: [],
    videos: [],
    ...overrides,
  };
}

function baseFilters(overrides: Partial<DiscoveryFilterState> = {}): DiscoveryFilterState {
  return {
    search: "",
    sortBy: "Catalogue order",
    budget: "",
    area: ALL_AREAS,
    propertyType: "All types",
    completionStatus: ALL_COMPLETION_STATUSES,
    beachDistance: "Any distance",
    ...overrides,
  };
}

/**
 * The live catalogue as the audit found it, in the database's own spellings —
 * `Under construction` and `Completed`, not the `Under Construction` / `Ready`
 * labels the filter used to compare against. Coralina carries no recorded
 * construction status at all.
 */
function catalogue(): Property[] {
  return [
    property({
      slug: "modeva",
      name: "Modeva",
      location: "Bang Tao",
      constructionStatus: "Planning",
    }),
    property({
      slug: "the-title-legendary",
      name: "The Title Legendary Bang-Tao",
      location: "Bang Tao",
      constructionStatus: "Completed",
    }),
    property({
      slug: "the-title-cielo",
      name: "The Title Cielo Rawai",
      location: "Rawai",
      constructionStatus: "Under construction",
    }),
    property({
      slug: "the-title-serenity",
      name: "The Title Serenity Naiyang",
      location: "Nai Yang",
      constructionStatus: "Completed",
    }),
    property({
      slug: "katabello",
      name: "The Katabello",
      location: "Kata",
      constructionStatus: "Under construction",
    }),
    property({
      slug: "the-title-villa-kirara",
      name: "The Title Villa Kirara",
      location: "Bang Tao",
      constructionStatus: "Under construction",
    }),
    property({
      slug: "the-adora",
      name: "Adora Rawai",
      location: "Rawai",
      constructionStatus: "Under construction",
    }),
    property({
      slug: "coralina",
      name: "The Title Coralina Kamala",
      location: "Kamala",
      constructionStatus: "",
    }),
  ];
}

const slugsFor = (filters: Partial<DiscoveryFilterState>) =>
  filterDiscoveryProjects(catalogue(), baseFilters(filters)).map((p) => p.slug);

/**
 * F-001. Every option compared a UI label against a stored value by exact,
 * case-sensitive equality, so `Under Construction` never matched the stored
 * `Under construction` and `Ready` never matched `Completed`. Selecting any
 * real build stage except Planning emptied the catalogue.
 */
describe("Discovery completion filter (F-001)", () => {
  it("returns every under-construction project", () => {
    expect(slugsFor({ completionStatus: "under-construction" })).toEqual([
      "the-title-cielo",
      "katabello",
      "the-title-villa-kirara",
      "the-adora",
    ]);
  });

  it("returns the completed projects for the Completed / Ready option", () => {
    expect(slugsFor({ completionStatus: "completed" })).toEqual([
      "the-title-legendary",
      "the-title-serenity",
    ]);
  });

  it("returns the planning project", () => {
    expect(slugsFor({ completionStatus: "planning" })).toEqual(["modeva"]);
  });

  it("matches regardless of the casing or separators the record happens to use", () => {
    const projects = [
      property({ slug: "lower", constructionStatus: "under construction" }),
      property({ slug: "upper", constructionStatus: "UNDER CONSTRUCTION" }),
      property({ slug: "snake", constructionStatus: "under_construction" }),
      property({ slug: "spaced", constructionStatus: "Under  Construction" }),
    ];
    const result = filterDiscoveryProjects(
      projects,
      baseFilters({ completionStatus: "under-construction" }),
    );
    expect(result.map((p) => p.slug)).toEqual(["lower", "upper", "snake", "spaced"]);
  });

  it("keeps an unknown or missing status out of every specific status filter", () => {
    // Coralina records no status; filing it under a build stage would be an
    // invented fact.
    for (const status of ["planning", "under-construction", "completed"] as const) {
      expect(slugsFor({ completionStatus: status })).not.toContain("coralina");
    }
  });

  it("never hides a project with an unknown status from the full catalogue", () => {
    expect(slugsFor({})).toContain("coralina");
  });

  it("All statuses returns the whole catalogue", () => {
    expect(slugsFor({ completionStatus: ALL_COMPLETION_STATUSES })).toHaveLength(8);
  });

  it("offers only statuses the catalogue can actually answer", () => {
    const options = buildCompletionOptions(catalogue());
    expect(options.map((o) => o.value)).toEqual([
      ALL_COMPLETION_STATUSES,
      "planning",
      "under-construction",
      "completed",
    ]);
    // The dead options the audit found are gone.
    const labels = options.map((o) => o.label);
    expect(labels).not.toContain("Nearing completion");
    expect(labels).not.toContain("Pre-launch");
    expect(labels).not.toContain("Sold out");
    expect(labels).toContain("Completed / Ready");
  });

  it("no offered status can produce an empty catalogue", () => {
    for (const option of buildCompletionOptions(catalogue())) {
      expect(slugsFor({ completionStatus: option.value }).length).toBeGreaterThan(0);
    }
  });
});

/**
 * F-002. The area list was hardcoded before the current catalogue existed: it
 * omitted Nai Yang and Kata entirely, and offered four areas holding nothing.
 */
describe("Discovery area filter (F-002)", () => {
  it("offers Nai Yang, because Serenity is there", () => {
    expect(buildAreaOptions(catalogue()).map((o) => o.value)).toContain("Nai Yang");
    expect(slugsFor({ area: "Nai Yang" })).toEqual(["the-title-serenity"]);
  });

  it("offers Kata, because KataBello is there", () => {
    expect(buildAreaOptions(catalogue()).map((o) => o.value)).toContain("Kata");
    expect(slugsFor({ area: "Kata" })).toEqual(["katabello"]);
  });

  it("does not offer areas with no public project", () => {
    const values = buildAreaOptions(catalogue()).map((o) => o.value);
    for (const dead of ["Surin Beach", "Layan", "Kata Noi"]) {
      expect(values).not.toContain(dead);
    }
  });

  it("offers every area exactly once, sorted, behind the reset option", () => {
    expect(buildAreaOptions(catalogue()).map((o) => o.value)).toEqual([
      ALL_AREAS,
      "Bang Tao",
      "Kamala",
      "Kata",
      "Nai Yang",
      "Rawai",
    ]);
  });

  it("treats casing and spacing differences as one area", () => {
    const projects = [
      property({ slug: "a", location: "Bang Tao" }),
      property({ slug: "b", location: "bang  tao" }),
      property({ slug: "c", location: "BANG TAO" }),
    ];
    expect(buildAreaOptions(projects).map((o) => o.value)).toEqual([ALL_AREAS, "Bang Tao"]);
    const result = filterDiscoveryProjects(projects, baseFilters({ area: "Bang Tao" }));
    expect(result.map((p) => p.slug)).toEqual(["a", "b", "c"]);
  });

  it("selecting an area shows exactly that area's projects", () => {
    expect(slugsFor({ area: "Bang Tao" })).toEqual([
      "modeva",
      "the-title-legendary",
      "the-title-villa-kirara",
    ]);
  });

  it("clearing the filter restores the catalogue", () => {
    expect(slugsFor({ area: ALL_AREAS })).toHaveLength(8);
  });

  it("surfaces a newly introduced area instead of hiding its project", () => {
    const withNewArea = [...catalogue(), property({ slug: "new", location: "Mai Khao" })];
    expect(buildAreaOptions(withNewArea).map((o) => o.value)).toContain("Mai Khao");
    expect(
      filterDiscoveryProjects(withNewArea, baseFilters({ area: "Mai Khao" })).map((p) => p.slug),
    ).toEqual(["new"]);
  });

  it("no offered area can produce an empty catalogue", () => {
    for (const option of buildAreaOptions(catalogue())) {
      expect(slugsFor({ area: option.value }).length).toBeGreaterThan(0);
    }
  });

  it("keeps the reset option even for an empty catalogue", () => {
    expect(buildAreaOptions([]).map((o) => o.value)).toEqual([ALL_AREAS]);
    expect(buildCompletionOptions([]).map((o) => o.value)).toEqual([ALL_COMPLETION_STATUSES]);
  });
});

describe("neutral Discovery sorting", () => {
  it("offers no recommendation, score, or verification sort options", () => {
    for (const option of discoverySortOptions) {
      expect(option.toLowerCase()).not.toContain("recommend");
      expect(option.toLowerCase()).not.toContain("score");
      expect(option.toLowerCase()).not.toContain("verified");
    }
    expect(discoverySortOptions[0]).toBe("Catalogue order");
  });

  it("exposes no verification filter in the filter state", () => {
    const filters = baseFilters();
    expect(filters).not.toHaveProperty("verifiedOnly");
  });

  it("catalogue order preserves the service's stable order verbatim", () => {
    const a = property({ slug: "a", name: "Zeta", foreverVerified: true, trustScore: 9 });
    const b = property({ slug: "b", name: "Alpha", foreverVerified: false, trustScore: 0 });
    const result = filterDiscoveryProjects([a, b], baseFilters());
    // Verification/score signals must not reorder the catalogue.
    expect(result.map((p) => p.slug)).toEqual(["a", "b"]);
  });

  it("name sort orders alphabetically regardless of scores", () => {
    const a = property({ slug: "a", name: "Zeta", trustScore: 10 });
    const b = property({ slug: "b", name: "Alpha", trustScore: 0 });
    const result = filterDiscoveryProjects([a, b], baseFilters({ sortBy: "Name A to Z" }));
    expect(result.map((p) => p.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("price sorts put projects without a recorded price last, both directions", () => {
    const priced = property({ slug: "priced", startingPriceTHB: 5_000_000 });
    const unpriced = property({ slug: "unpriced", startingPriceTHB: 0, price: "" });
    const cheap = property({ slug: "cheap", startingPriceTHB: 1_000_000 });

    const asc = filterDiscoveryProjects(
      [unpriced, priced, cheap],
      baseFilters({ sortBy: "Price low to high" }),
    );
    expect(asc.map((p) => p.slug)).toEqual(["cheap", "priced", "unpriced"]);

    const desc = filterDiscoveryProjects(
      [unpriced, priced, cheap],
      baseFilters({ sortBy: "Price high to low" }),
    );
    expect(desc.map((p) => p.slug)).toEqual(["priced", "cheap", "unpriced"]);
  });
});
