import { describe, expect, it } from "vitest";

import type { Property } from "@/lib/data";
import {
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
    area: "All areas",
    propertyType: "All types",
    completionStatus: "Any status",
    beachDistance: "Any distance",
    ...overrides,
  };
}

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
