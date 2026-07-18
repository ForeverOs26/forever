import { describe, expect, it } from "vitest";

import type { Property } from "@/lib/data";
import {
  NO_EXACT_MATCH_MESSAGE,
  deriveDecisionProfile,
  evaluateCatalogue,
  evaluateMatch,
  type NavigatorAnswers,
} from "./index";

function property(overrides: Partial<Property> = {}): Property {
  return {
    slug: "test-project",
    name: "Test Project",
    developer: "Dev",
    location: "Bang Tao",
    propertyType: "Villa",
    constructionStatus: "Ready",
    status: "Available",
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
    foreverVerified: true,
    trustScore: 0,
    trustNote: "",
    investmentValue: 0,
    marketPosition: "In line with market",
    verdict: "Strong Buy",
    distanceToBeach: "",
    distanceToAirport: "",
    nearbySchools: [],
    nearbyHospitals: [],
    lifestyle: [],
    rentalYield: "",
    rentalDemand: "Moderate",
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

const investorAnswers: NavigatorAnswers = {
  motivations: ["investment"],
  goals: ["rental_income"],
  budget: "500k_1m", // ceiling 35,000,000 THB
  timeline: "ready_now",
  concerns: ["rental_returns"],
  note: "",
};

describe("evaluateMatch — only source-backed reasons", () => {
  it("emits no fabricated reason for sparse project data (Modeva-like null price)", () => {
    const profile = deriveDecisionProfile(investorAnswers);
    const sparse = property({ slug: "the-modeva-bang-tao", startingPriceTHB: 0, rentalYield: "" });
    expect(evaluateMatch(profile, sparse)).toEqual([]);
  });

  it("emits Within selected budget only when both sides have the fact", () => {
    const profile = deriveDecisionProfile(investorAnswers);
    const inBudget = property({ startingPriceTHB: 20_000_000 });
    const overBudget = property({ startingPriceTHB: 90_000_000 });

    expect(evaluateMatch(profile, inBudget).map((r) => r.kind)).toContain("budget");
    expect(evaluateMatch(profile, overBudget).map((r) => r.kind)).not.toContain("budget");
  });

  it("does not emit a budget reason when the guest is still exploring budget", () => {
    const profile = deriveDecisionProfile({ ...investorAnswers, budget: "exploring" });
    const priced = property({ startingPriceTHB: 20_000_000 });
    expect(evaluateMatch(profile, priced).map((r) => r.kind)).not.toContain("budget");
  });

  it("notes purchase-goal evidence only when the record carries a rental yield", () => {
    const profile = deriveDecisionProfile(investorAnswers);
    const withYield = property({ startingPriceTHB: 10_000_000, rentalYield: "6% net" });
    const withoutYield = property({ startingPriceTHB: 10_000_000, rentalYield: "" });

    expect(evaluateMatch(profile, withYield).map((r) => r.kind)).toContain("purpose_evidence");
    expect(evaluateMatch(profile, withoutYield).map((r) => r.kind)).not.toContain(
      "purpose_evidence",
    );
  });

  it("never emits location/format reasons from NAV-001 (no such profile fact)", () => {
    const profile = deriveDecisionProfile(investorAnswers);
    expect(profile.preferredAreas).toEqual([]);
    expect(profile.preferredPropertyTypes).toEqual([]);
    const priced = property({ startingPriceTHB: 20_000_000, location: "Bang Tao" });
    const kinds = evaluateMatch(profile, priced).map((r) => r.kind);
    expect(kinds).not.toContain("location");
    expect(kinds).not.toContain("property_format");
  });
});

describe("evaluateCatalogue — no-match fallback + browse all", () => {
  it("uses the honest no-exact-match line when nothing earns a reason", () => {
    const profile = deriveDecisionProfile(investorAnswers);
    const catalogue = [
      property({ slug: "the-modeva-bang-tao", startingPriceTHB: 0 }),
      property({ slug: "coralina", startingPriceTHB: 0 }),
    ];
    const result = evaluateCatalogue(profile, catalogue);

    expect(result.hasSupportedMatch).toBe(false);
    expect(result.noMatchMessage).toBe(NO_EXACT_MATCH_MESSAGE);
    // Every project is still returned so the employee can browse/select any.
    expect(result.results.map((r) => r.project.slug)).toEqual([
      "the-modeva-bang-tao",
      "coralina",
    ]);
  });

  it("drops the fallback line once any project earns a supported reason", () => {
    const profile = deriveDecisionProfile(investorAnswers);
    const catalogue = [
      property({ slug: "priced", startingPriceTHB: 15_000_000 }),
      property({ slug: "sparse", startingPriceTHB: 0 }),
    ];
    const result = evaluateCatalogue(profile, catalogue);

    expect(result.hasSupportedMatch).toBe(true);
    expect(result.noMatchMessage).toBeNull();
    expect(result.results).toHaveLength(2); // browse-all preserved
  });
});
