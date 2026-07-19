import { describe, expect, it } from "vitest";

import type { Property } from "@/lib/data";
import {
  NO_EXACT_MATCH_MESSAGE,
  PROJECT_PRICE_CURRENCY,
  deriveDecisionProfile,
  evaluateCatalogue,
  evaluateMatch,
  extractQuantifiedYieldPercent,
  isUnavailableValue,
  visibleResults,
  type DecisionProfile,
  type NavigatorAnswers,
} from "./index";
import * as coreModule from "./index";

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
  budget: "500k_1m", // USD band — NOT comparable to THB prices
  timeline: "ready_now",
  concerns: ["rental_returns"],
  note: "",
};

/** A hypothetical future profile whose budget is canonically THB-normalized. */
function thbProfile(amount: number): DecisionProfile {
  return {
    ...deriveDecisionProfile(investorAnswers),
    budgetCeiling: { amount, currency: "THB" },
  };
}

describe("no fixed FX conversion exists", () => {
  it("exports no USD_TO_THB constant and no THB-converting ceiling helper", () => {
    const exported = coreModule as Record<string, unknown>;
    expect(exported.USD_TO_THB).toBeUndefined();
    expect(exported.budgetCeilingTHB).toBeUndefined();
  });

  it("keeps the NAV-001 USD budget band as raw data on the profile", () => {
    const profile = deriveDecisionProfile(investorAnswers);
    expect(profile.budget).toBe("500k_1m");
    expect(profile.budgetCeiling).toEqual({ amount: 1_000_000, currency: "USD" });
    expect(PROJECT_PRICE_CURRENCY).toBe("THB");
  });
});

describe("evaluateMatch — only source-backed reasons", () => {
  it("emits NO budget reason across incomparable currencies (USD band vs THB price)", () => {
    // Missing comparable currency data is missing data, never a negative match.
    const profile = deriveDecisionProfile(investorAnswers);
    const priced = property({ startingPriceTHB: 20_000_000 });
    expect(evaluateMatch(profile, priced).map((r) => r.kind)).not.toContain("budget");
  });

  it("emits a budget reason once a canonically comparable THB ceiling exists", () => {
    // Future currency-normalized budget: same evaluator, no shell change.
    const inBudget = property({ startingPriceTHB: 20_000_000 });
    const overBudget = property({ startingPriceTHB: 90_000_000 });
    expect(evaluateMatch(thbProfile(35_000_000), inBudget).map((r) => r.kind)).toContain("budget");
    expect(evaluateMatch(thbProfile(35_000_000), overBudget).map((r) => r.kind)).not.toContain(
      "budget",
    );
  });

  it("emits no fabricated reason for sparse project data (Modeva-like null price)", () => {
    const sparse = property({ slug: "the-modeva-bang-tao", startingPriceTHB: 0, rentalYield: "" });
    expect(evaluateMatch(thbProfile(35_000_000), sparse)).toEqual([]);
    expect(evaluateMatch(deriveDecisionProfile(investorAnswers), sparse)).toEqual([]);
  });

  it("does not emit a budget reason when the guest is still exploring budget", () => {
    const profile = deriveDecisionProfile({ ...investorAnswers, budget: "exploring" });
    expect(profile.budgetCeiling).toBeNull();
    const priced = property({ startingPriceTHB: 20_000_000 });
    expect(evaluateMatch(profile, priced).map((r) => r.kind)).not.toContain("budget");
  });

  it("notes purchase-goal evidence only when the record carries a rental yield", () => {
    const profile = deriveDecisionProfile(investorAnswers);
    const withYield = property({ rentalYield: "6% net" });
    const withoutYield = property({ rentalYield: "" });

    expect(evaluateMatch(profile, withYield).map((r) => r.kind)).toContain("purpose_evidence");
    expect(evaluateMatch(profile, withoutYield).map((r) => r.kind)).not.toContain(
      "purpose_evidence",
    );
  });

  it.each([
    ["Not available"],
    ["N/A"],
    ["n/a"],
    ["Unknown"],
    ["unresolved"],
    ["None"],
    ["-"],
    ["—"],
    ["   "],
    [""],
  ])("emits no investment reason when rentalYield is the sentinel %j", (sentinel) => {
    const profile = deriveDecisionProfile(investorAnswers);
    const project = property({ rentalYield: sentinel });
    expect(evaluateMatch(profile, project).map((r) => r.kind)).not.toContain("purpose_evidence");
  });

  it("emits no investment reason for non-quantified promotional text", () => {
    const profile = deriveDecisionProfile(investorAnswers);
    const promotional = property({ rentalYield: "Strong rental potential" });
    expect(evaluateMatch(profile, promotional).map((r) => r.kind)).not.toContain(
      "purpose_evidence",
    );
  });

  it("emits no investment reason for a zero or negative quantified yield", () => {
    const profile = deriveDecisionProfile(investorAnswers);
    expect(
      evaluateMatch(profile, property({ rentalYield: "0%" })).map((r) => r.kind),
    ).not.toContain("purpose_evidence");
  });

  it("still emits the investment reason for a valid quantified positive yield", () => {
    const profile = deriveDecisionProfile(investorAnswers);
    for (const value of ["6%", "6.5%", "Up to 6% net", "6 %"]) {
      expect(evaluateMatch(profile, property({ rentalYield: value })).map((r) => r.kind)).toContain(
        "purpose_evidence",
      );
    }
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

describe("isUnavailableValue — the reusable sentinel guard", () => {
  it.each([
    null,
    undefined,
    "",
    "   ",
    "Not available",
    "NOT AVAILABLE",
    "  not available  ",
    "N/A",
    "n/a",
    "NA",
    "Unknown",
    "UNKNOWN",
    "Unresolved",
    "None",
    "-",
    "--",
    "—",
    "–",
  ])("treats %j as unavailable", (value) => {
    expect(isUnavailableValue(value)).toBe(true);
  });

  it.each(["Bang Tao", "6%", "Villa", "Some real value"])(
    "treats %j as an actual usable value",
    (value) => {
      expect(isUnavailableValue(value)).toBe(false);
    },
  );
});

describe("extractQuantifiedYieldPercent — conservative yield parsing", () => {
  it("parses a plain quantified percentage", () => {
    expect(extractQuantifiedYieldPercent("6%")).toBe(6);
    expect(extractQuantifiedYieldPercent("6.5%")).toBe(6.5);
    expect(extractQuantifiedYieldPercent("Up to 6% net")).toBe(6);
  });

  it("returns null for sentinels, empty values, and non-quantified text", () => {
    expect(extractQuantifiedYieldPercent("Not available")).toBeNull();
    expect(extractQuantifiedYieldPercent("N/A")).toBeNull();
    expect(extractQuantifiedYieldPercent("")).toBeNull();
    expect(extractQuantifiedYieldPercent(null)).toBeNull();
    expect(extractQuantifiedYieldPercent(undefined)).toBeNull();
    expect(extractQuantifiedYieldPercent("Strong rental potential")).toBeNull();
  });

  it("returns null for a zero or unparseable figure", () => {
    expect(extractQuantifiedYieldPercent("0%")).toBeNull();
    expect(extractQuantifiedYieldPercent("six percent")).toBeNull();
  });
});

describe("location matching never fires on a sentinel location", () => {
  it("emits no location reason when the project location is a sentinel", () => {
    // Simulates a future NAV-001 that does collect a preferred area.
    const profile: DecisionProfile = {
      ...deriveDecisionProfile(investorAnswers),
      preferredAreas: ["Bang Tao"],
    };
    const sentinelLocation = property({ location: "Not available" });
    const realLocation = property({ location: "Bang Tao" });

    expect(evaluateMatch(profile, sentinelLocation).map((r) => r.kind)).not.toContain("location");
    expect(evaluateMatch(profile, realLocation).map((r) => r.kind)).toContain("location");
  });
});

describe("evaluateCatalogue — matched/all contract", () => {
  it("separates matchedResults from allResults, preserving catalogue order", () => {
    const profile = deriveDecisionProfile(investorAnswers);
    const catalogue = [
      property({ slug: "sparse-first" }),
      property({ slug: "with-yield", rentalYield: "6%" }),
      property({ slug: "sparse-last" }),
    ];
    const result = evaluateCatalogue(profile, catalogue);

    expect(result.hasSupportedMatch).toBe(true);
    expect(result.noMatchMessage).toBeNull();
    expect(result.matchedResults.map((r) => r.project.slug)).toEqual(["with-yield"]);
    // Complete catalogue, original order, no invented ranking.
    expect(result.allResults.map((r) => r.project.slug)).toEqual([
      "sparse-first",
      "with-yield",
      "sparse-last",
    ]);
  });

  it("uses the honest no-exact-match line when nothing earns a reason", () => {
    const profile = deriveDecisionProfile(investorAnswers);
    const catalogue = [
      property({ slug: "the-modeva-bang-tao", startingPriceTHB: 0 }),
      property({ slug: "coralina", startingPriceTHB: 0 }),
    ];
    const result = evaluateCatalogue(profile, catalogue);

    expect(result.hasSupportedMatch).toBe(false);
    expect(result.noMatchMessage).toBe(NO_EXACT_MATCH_MESSAGE);
    expect(result.matchedResults).toEqual([]);
    expect(result.allResults.map((r) => r.project.slug)).toEqual([
      "the-modeva-bang-tao",
      "coralina",
    ]);
  });
});

describe("visibleResults — shared presentation rule for both shells", () => {
  const profile = deriveDecisionProfile(investorAnswers);
  const catalogue = [
    property({ slug: "matched", rentalYield: "6%" }),
    property({ slug: "unmatched" }),
  ];

  it("shows only matched projects by default when supported matches exist", () => {
    const evaluation = evaluateCatalogue(profile, catalogue);
    expect(visibleResults(evaluation, false).map((r) => r.project.slug)).toEqual(["matched"]);
  });

  it("shows the complete catalogue on Browse all projects", () => {
    const evaluation = evaluateCatalogue(profile, catalogue);
    expect(visibleResults(evaluation, true).map((r) => r.project.slug)).toEqual([
      "matched",
      "unmatched",
    ]);
  });

  it("shows the complete catalogue under the fallback when nothing matched", () => {
    const evaluation = evaluateCatalogue(profile, [property({ slug: "a" }), property({ slug: "b" })]);
    expect(evaluation.noMatchMessage).toBe(NO_EXACT_MATCH_MESSAGE);
    expect(visibleResults(evaluation, false).map((r) => r.project.slug)).toEqual(["a", "b"]);
  });
});
