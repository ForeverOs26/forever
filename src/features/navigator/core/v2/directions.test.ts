import { describe, expect, it } from "vitest";

import type { Property } from "@/lib/data";
import { emptyAnswers } from "../decision-profile";
import {
  NO_DIRECTION_MESSAGE,
  evaluateDirections,
  parseBedsRange,
  visibleDirections,
} from "./directions";
import {
  canonicalThbBudget,
  statedBudget,
  profileV2FromLegacyAnswers,
  type DecisionProfileV2,
  type FxRateConfig,
  type SearchEssentials,
} from "./profile";

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

const datedFx: FxRateConfig = {
  source: "operator daily reference",
  effectiveDate: "2026-07-25",
  thbPerUnit: { USD: 36 },
};

function profileWith(
  essentials: Partial<SearchEssentials>,
  extra: Partial<DecisionProfileV2> = {},
): DecisionProfileV2 {
  const base = profileV2FromLegacyAnswers(emptyAnswers());
  return {
    ...base,
    purchasePurpose: "lifestyle",
    essentials: { ...base.essentials, ...essentials },
    confirmedAt: "2026-07-25T10:00:00.000Z",
    ...extra,
  };
}

describe("parseBedsRange (conservative)", () => {
  it("parses only unambiguous forms", () => {
    expect(parseBedsRange("2")).toEqual({ minimum: 2, maximum: 2 });
    expect(parseBedsRange("1-3")).toEqual({ minimum: 1, maximum: 3 });
    expect(parseBedsRange("1–3")).toEqual({ minimum: 1, maximum: 3 });
    expect(parseBedsRange("Studio")).toEqual({ minimum: 0, maximum: 0 });
  });

  it("fails closed on ambiguous, sentinel, or inverted strings", () => {
    expect(parseBedsRange("Studio – 2BR")).toBeNull();
    expect(parseBedsRange("1-3 + Penthouse")).toBeNull();
    expect(parseBedsRange("3-1")).toBeNull();
    expect(parseBedsRange("Not available")).toBeNull();
    expect(parseBedsRange("")).toBeNull();
    expect(parseBedsRange(null)).toBeNull();
  });
});

describe("evaluateDirections — fail-closed reasons", () => {
  it("emits a property-type reason only when both sides state the fact", () => {
    const cards = evaluateDirections(profileWith({ propertyType: "villa" }), [
      property({ propertyType: "Villa" }),
      property({ slug: "condo", propertyType: "Condominium" }),
      property({ slug: "na", propertyType: "Not available" }),
    ]);
    expect(cards.all[0].whyShown.map((r) => r.dimension)).toContain("property_type");
    expect(cards.all[1].whyShown).toHaveLength(0);
    expect(cards.all[2].whyShown).toHaveLength(0);
    expect(cards.all[2].unknowns).toContainEqual(
      expect.objectContaining({ dimension: "property_type", kind: "no_suitable_project_fact" }),
    );
  });

  it("emits no readiness reason when construction status is absent", () => {
    const cards = evaluateDirections(profileWith({ readiness: "ready" }), [
      property({ constructionStatus: "Not available" }),
    ]);
    expect(cards.all[0].whyShown).toHaveLength(0);
    expect(cards.all[0].unknowns).toContainEqual(
      expect.objectContaining({ dimension: "readiness", kind: "no_suitable_project_fact" }),
    );
  });

  it("matches off-plan readiness to under-construction statuses", () => {
    const cards = evaluateDirections(profileWith({ readiness: "off_plan" }), [
      property({ constructionStatus: "Under Construction" }),
    ]);
    expect(cards.all[0].whyShown.map((r) => r.dimension)).toContain("readiness");
  });

  it("fails closed on ambiguous bedroom strings", () => {
    const cards = evaluateDirections(profileWith({ bedrooms: "2" }), [
      property({ beds: "1-3BR + Penthouse" }),
      property({ slug: "clean", beds: "1-3" }),
    ]);
    expect(cards.all[0].whyShown).toHaveLength(0);
    expect(cards.all[0].unknowns).toContainEqual(
      expect.objectContaining({ dimension: "bedrooms", kind: "no_suitable_project_fact" }),
    );
    expect(cards.all[1].whyShown.map((r) => r.dimension)).toContain("bedrooms");
  });

  it("matches a location preference only against an actual location value", () => {
    const cards = evaluateDirections(profileWith({ preferredAreas: ["Bang Tao"] }), [
      property({ location: "Bang Tao" }),
      property({ slug: "missing", location: "Not available" }),
    ]);
    expect(cards.all[0].whyShown.map((r) => r.dimension)).toContain("location");
    expect(cards.all[1].unknowns).toContainEqual(
      expect.objectContaining({ dimension: "location", kind: "no_suitable_project_fact" }),
    );
  });

  it("'help me choose' produces no location reason and no missing-answer unknown", () => {
    const cards = evaluateDirections(profileWith({ preferredAreas: [], helpMeChooseArea: true }), [
      property(),
    ]);
    expect(cards.all[0].whyShown.filter((r) => r.dimension === "location")).toHaveLength(0);
    expect(cards.all[0].unknowns.filter((u) => u.dimension === "location")).toHaveLength(0);
  });
});

describe("evaluateDirections — budget truthfulness", () => {
  const statedUsd = statedBudget(500_000, 1_000_000, "USD");

  it("missing FX disables budget matching (never a mismatch)", () => {
    const profile = profileWith({}, { budget: statedUsd, canonicalThb: null });
    const cards = evaluateDirections(profile, [property({ startingPriceTHB: 20_000_000 })]);
    expect(cards.all[0].whyShown.filter((r) => r.dimension === "budget")).toHaveLength(0);
    expect(cards.all[0].unknowns).toContainEqual(
      expect.objectContaining({ dimension: "budget", kind: "project_evidence_missing" }),
    );
  });

  it("a dated verified rate enables a comparable match with source + date in the label", () => {
    const profile = profileWith(
      {},
      { budget: statedUsd, canonicalThb: canonicalThbBudget(statedUsd, datedFx) },
    );
    const inRange = evaluateDirections(profile, [property({ startingPriceTHB: 20_000_000 })]);
    const budgetReason = inRange.all[0].whyShown.find((r) => r.dimension === "budget");
    expect(budgetReason).toBeDefined();
    expect(budgetReason?.label).toContain("operator daily reference");
    expect(budgetReason?.label).toContain("2026-07-25");

    const outOfRange = evaluateDirections(profile, [property({ startingPriceTHB: 40_000_000 })]);
    expect(outOfRange.all[0].whyShown.filter((r) => r.dimension === "budget")).toHaveLength(0);
  });

  it("a missing project price yields no budget reason", () => {
    const profile = profileWith(
      {},
      { budget: statedUsd, canonicalThb: canonicalThbBudget(statedUsd, datedFx) },
    );
    const cards = evaluateDirections(profile, [property({ startingPriceTHB: 0 })]);
    expect(cards.all[0].whyShown.filter((r) => r.dimension === "budget")).toHaveLength(0);
    expect(cards.all[0].unknowns).toContainEqual(
      expect.objectContaining({ dimension: "budget", kind: "no_suitable_project_fact" }),
    );
  });
});

describe("evaluateDirections — investment evidence", () => {
  it("promotional rental language never becomes a reason", () => {
    const cards = evaluateDirections(profileWith({}, { purchasePurpose: "investment" }), [
      property({ rentalYield: "Strong rental potential" }),
      property({ slug: "range", rentalYield: "6%–8% guaranteed" }),
      property({ slug: "quantified", rentalYield: "6%" }),
    ]);
    expect(cards.all[0].whyShown).toHaveLength(0);
    expect(cards.all[1].whyShown).toHaveLength(0);
    expect(cards.all[2].whyShown.map((r) => r.dimension)).toContain("purpose_evidence");
    expect(cards.all[0].unknowns).toContainEqual(
      expect.objectContaining({ dimension: "purpose_evidence", kind: "project_evidence_missing" }),
    );
  });
});

describe("evaluateDirections — cards stay truthful", () => {
  it("never fabricates a trade-off and never emits scores or rankings", () => {
    const evaluation = evaluateDirections(profileWith({ propertyType: "villa" }), [
      property({ tagline: "Luxury living with infinity pools" }),
    ]);
    const card = evaluation.all[0];
    expect(card.tradeOff).toBeNull(); // UI renders the honest absence line
    // The evaluation's own output carries no score, percentage, or ranking —
    // only the untouched project record and the reason/unknown lists.
    const { project: _project, ...evaluated } = card;
    expect(JSON.stringify(evaluated)).not.toMatch(/score|percent|ranking|best/i);
  });

  it("surfaces price freshness truthfully", () => {
    const evaluation = evaluateDirections(profileWith({}), [
      property({ lastPriceUpdate: "2026-06-01" }),
      property({ slug: "stale", lastPriceUpdate: "Not available" }),
    ]);
    expect(evaluation.all[0].freshness.lastPriceUpdate).toBe("2026-06-01");
    expect(evaluation.all[1].freshness.lastPriceUpdate).toBeNull();
  });

  it("keeps catalogue order and shows the full catalogue under the honest fallback", () => {
    const projects = [property({ slug: "a" }), property({ slug: "b" })];
    const evaluation = evaluateDirections(profileWith({}), projects);
    expect(evaluation.hasSupportedDirection).toBe(false);
    expect(evaluation.noDirectionMessage).toBe(NO_DIRECTION_MESSAGE);
    expect(visibleDirections(evaluation, false).map((c) => c.project.slug)).toEqual(["a", "b"]);
  });
});
