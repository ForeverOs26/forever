import { describe, expect, it } from "vitest";

import { NOT_AVAILABLE } from "../investment-intelligence";
import { deriveForeverPassport } from "../forever-passport";
import { deriveProjectSummary } from "../project-summary";
import type { ProjectDetail } from "@/features/project-detail/project-detail-types";
import { makeInvestmentRow, makeProject, makeUnit } from "./fixtures";

/**
 * A fully-populated project that pushes every foundation to its highest verdict.
 * Used to prove the Summary aggregates real evidence without inventing scores.
 */
function makeRichProject(): ProjectDetail {
  return makeProject({
    core: {
      name: "Modeva",
      slug: "the-modeva-bang-tao",
      type: "Condominium",
      location: "Bang Tao",
      address: "1 Beach Road, Bang Tao, Phuket",
      constructionStatus: "Under Construction",
      ownershipType: "Freehold",
    },
    pricing: {
      startingPriceTHB: 5_000_000,
      verifiedPrice: "THB 5,000,000",
      lastPriceUpdate: "2026-01-15",
    },
    trust: {
      foreverVerified: true,
      trustScore: 88,
      trustNote: "Independently inspected on site.",
      marketPosition: "Upper-mid segment",
      verdict: "Forever Verified — strong record",
      lastInspection: "2026-02-01",
    },
    investment: {
      rentalDemand: "Strong",
      rows: [
        makeInvestmentRow({
          expectedMonthlyRent: 40_000,
          occupancyRate: 75,
          annualRoiPercent: 6.5,
          guaranteedRentalPercent: 6,
          guaranteeYears: 3,
          managementCompany: "Forever Rentals",
        }),
      ],
    },
    location: {
      area: "Bang Tao",
      distanceToBeach: "500 m",
      distanceToAirport: "20 km",
      nearbySchools: ["Intl School"],
      nearbyHospitals: ["Clinic"],
      lifestyle: ["Beach club", "Restaurants"],
    },
    units: [
      makeUnit({
        type: "Condominium",
        paymentPlan: "30/70",
        basePriceTHB: 5_000_000,
        rentalGuarantee: "6% for 3 years",
        availabilityStatus: "available",
      }),
      makeUnit({
        id: "unit-2",
        type: "Villa",
        basePriceTHB: 6_000_000,
        availabilityStatus: "sold",
      }),
    ],
  });
}

/** Build a summary from a project by first deriving the Passport (the source). */
function summaryFor(project: ProjectDetail, generatedAt?: string) {
  const passport = deriveForeverPassport(project);
  return deriveProjectSummary({ project, passport, generatedAt });
}

// Matches invented-score / fabricated-metric shapes (X/100, X/10, N points, N%),
// without false-positiving on verified data like a "30/70" payment plan.
const NUMERIC_SCORE =
  /\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s*\/\s*(?:100|10)\b|\b\d+(?:\.\d+)?\s*points?\b/i;

describe("deriveProjectSummary — complete project data", () => {
  const project = makeRichProject();
  const summary = summaryFor(project);

  it("builds a controlled executive overview from verified identity facts", () => {
    expect(summary.overview.headline).toBe(
      "Modeva is a Condominium in Bang Tao by Title, currently Under Construction.",
    );
    expect(summary.overview.readinessStatement).toBe(
      "Overall advisory readiness: Ready for preliminary review.",
    );
  });

  it("surfaces the main evidence-backed signals per domain", () => {
    const byKey = Object.fromEntries(summary.overview.signals.map((s) => [s.key, s.value]));
    expect(byKey.trust).toBe("Forever Verified");
    expect(byKey.investment).toBe("From THB 5,000,000");
    expect(byKey.rental).toContain("Strong");
    expect(byKey.location).toBe("Bang Tao");
  });

  it("surfaces only present verified key facts", () => {
    const facts = Object.fromEntries(summary.keyFacts.map((f) => [f.label, f.value]));
    expect(facts.Developer).toBe("Title");
    expect(facts.Location).toBe("Bang Tao");
    expect(facts["Project type"]).toBe("Condominium");
    expect(facts["Construction status"]).toBe("Under Construction");
    expect(facts["Tenure / ownership"]).toBe("Freehold");
    expect(facts["Starting price"]).toBe("From THB 5,000,000");
    expect(facts["Unit types"]).toBe("Condominium, Villa");
    expect(facts["Project scale"]).toBe("2 unit(s) on record");
    // Never a "Not available" placeholder inside the surfaced facts.
    expect(summary.keyFacts.every((f) => f.value !== NOT_AVAILABLE)).toBe(true);
  });

  it("aggregates evidence-backed strengths from every domain", () => {
    expect(summary.strengths).toContain("Forever Verified project record.");
    expect(summary.strengths).toContain("Independently verified pricing.");
    expect(summary.strengths).toContain("Rental income evidence on record.");
    expect(summary.strengths).toContain("Beach proximity on record.");
  });

  it("reports no material considerations when the record is complete", () => {
    expect(summary.considerations).toEqual([]);
  });
});

describe("deriveProjectSummary — reuse of the Passport readiness verdict", () => {
  it("uses the Passport overall verdict verbatim (no second readiness engine)", () => {
    const project = makeRichProject();
    const passport = deriveForeverPassport(project);
    const summary = deriveProjectSummary({ project, passport });

    expect(summary.decisionReadiness.verdict).toBe(passport.overallVerdict.readinessVerdict);
    expect(summary.decisionReadiness.rationale).toBe(passport.overallVerdict.rationale);
    expect(summary.metadata.readinessVerdict).toBe(passport.overallVerdict.readinessVerdict);
    expect(summary.decisionReadiness.foundationsReady).toBe(
      passport.evidenceCoverage.foundationsReady,
    );
    expect(summary.decisionReadiness.signalsPresent).toBe(passport.dataCompleteness.signalsPresent);
  });

  it("carries a conservative verdict through for a sparse record", () => {
    const summary = summaryFor(makeProject());
    expect(summary.decisionReadiness.verdict).toBe("Insufficient verified data");
  });
});

describe("deriveProjectSummary — partially populated project data", () => {
  const project = makeProject({
    core: {
      name: "Modeva",
      slug: "the-modeva-bang-tao",
      type: "Condominium",
      location: "Bang Tao",
      address: "1 Beach Road, Bang Tao, Phuket",
      constructionStatus: "Planning",
      ownershipType: "Freehold",
    },
    pricing: { startingPriceTHB: 5_000_000 },
    location: {
      area: "Bang Tao",
      distanceToBeach: "500 m",
      lifestyle: ["Beach club"],
    },
  });
  const summary = summaryFor(project);

  it("includes present facts and omits absent ones", () => {
    const labels = summary.keyFacts.map((f) => f.label);
    expect(labels).toContain("Starting price");
    expect(labels).toContain("Location");
    // No units on record → no unit-derived facts.
    expect(labels).not.toContain("Unit types");
    expect(labels).not.toContain("Project scale");
  });

  it("flags the listed-but-unverified price as a consideration", () => {
    expect(summary.considerations).toContain(
      "Entry price is listed but not independently verified.",
    );
  });
});

describe("deriveProjectSummary — absent optional fields", () => {
  const summary = summaryFor(makeProject({ developer: null }));

  it("falls back to controlled wording when identity fields are missing", () => {
    // No developer clause when the developer is absent.
    expect(summary.overview.headline).not.toMatch(/ by /);
    expect(summary.overview.headline).toBe(
      "Modeva is a Condominium in Bang Tao, currently Planning.",
    );
  });

  it("omits the developer from the key facts", () => {
    expect(summary.keyFacts.some((f) => f.label === "Developer")).toBe(false);
  });

  it("renders unavailable domain signals via the shared 'Not available' sentinel", () => {
    const investment = summary.overview.signals.find((s) => s.key === "investment");
    // Sparse fixture has no starting price → investment signal is unavailable.
    expect(investment?.value).toBe(NOT_AVAILABLE);
  });

  it("surfaces data limitations for the missing fields", () => {
    expect(summary.dataLimitations).toContain("Entry price");
    expect(summary.dataLimitations).toContain("Developer record");
  });
});

describe("deriveProjectSummary — anti-fabrication guarantees", () => {
  it("never emits a numeric score anywhere in the summary", () => {
    for (const project of [makeRichProject(), makeProject()]) {
      const summary = summaryFor(project);
      const serialised = JSON.stringify(summary);
      expect(serialised).not.toMatch(NUMERIC_SCORE);
    }
  });

  it("never surfaces or reuses the hidden numeric trust score", () => {
    const project = makeRichProject();
    // trustScore is 88 in the rich fixture; it must never appear.
    const summary = summaryFor(project);
    expect(JSON.stringify(summary)).not.toContain("88");
  });

  it("does not invent a buyer persona when no suitability output exists", () => {
    const summary = summaryFor(makeProject());
    // Sparse record: no rental evidence, but Freehold tenure is on record.
    expect(summary.buyerProfile.basis).toMatch(/no demographic persona/i);
    // No age/income/family persona language is ever produced.
    expect(JSON.stringify(summary.buyerProfile)).not.toMatch(
      /retiree|family|young|expat|millennial|aged?\b/i,
    );
  });

  it("marks the buyer profile unavailable when no evidence supports it", () => {
    const project = makeProject({
      core: { ownershipType: "" },
      location: { area: "Bang Tao", lifestyle: [], distanceToBeach: "" },
    });
    const summary = summaryFor(project);
    expect(summary.buyerProfile.available).toBe(false);
    expect(summary.buyerProfile.statements).toEqual([]);
    expect(summary.buyerProfile.unavailableLabel).toBe(NOT_AVAILABLE);
  });

  it("does not use promotional or sales language in the overview", () => {
    const summary = summaryFor(makeRichProject());
    const overviewText = `${summary.overview.headline} ${summary.overview.readinessStatement}`;
    expect(overviewText).not.toMatch(
      /\b(best|luxury|stunning|amazing|opportunity|must[- ]?(buy|have)|exclusive|prime|unbeatable|guaranteed returns)\b/i,
    );
  });
});

describe("deriveProjectSummary — deterministic and deduplicated", () => {
  it("produces identical output for identical inputs", () => {
    const a = summaryFor(makeRichProject());
    const b = summaryFor(makeRichProject());
    expect(a).toEqual(b);
  });

  it("keeps a stable generation timestamp only when supplied", () => {
    expect(summaryFor(makeRichProject()).metadata.generatedAt).toBe(NOT_AVAILABLE);
    expect(summaryFor(makeRichProject(), "2026-07-11T00:00:00Z").metadata.generatedAt).toBe(
      "2026-07-11T00:00:00Z",
    );
  });

  it("de-duplicates strengths surfaced by more than one domain", () => {
    // The rich record carries rent figures → both Investment and Rental report
    // "Rental income evidence on record." It must appear exactly once.
    const strengths = summaryFor(makeRichProject()).strengths;
    const income = strengths.filter((s) => s === "Rental income evidence on record.");
    expect(income).toHaveLength(1);
    expect(new Set(strengths).size).toBe(strengths.length);
  });

  it("de-duplicates considerations surfaced by more than one domain", () => {
    // A sparse record has no rent evidence → both Investment and Rental would
    // caution about missing income evidence. It must appear exactly once.
    const considerations = summaryFor(makeProject()).considerations;
    const income = considerations.filter((c) => c === "Rental income evidence is not on record.");
    expect(income).toHaveLength(1);
    expect(new Set(considerations).size).toBe(considerations.length);
  });

  it("de-duplicates data-limitation gaps surfaced by more than one domain", () => {
    // Investment "Rental / income evidence" and Rental "Rental income evidence"
    // canonicalise to one gap. It must appear exactly once.
    const gaps = summaryFor(makeProject()).dataLimitations;
    const income = gaps.filter((g) => g === "Rental income evidence");
    expect(income).toHaveLength(1);
    expect(new Set(gaps).size).toBe(gaps.length);
  });
});

describe("deriveProjectSummary — reuse of already-derived outputs", () => {
  it("consumes supplied intelligence outputs without recomputing verdicts", () => {
    const project = makeRichProject();
    const passport = deriveForeverPassport(project);
    // Supplying the outputs explicitly must equal deriving them internally.
    const explicit = deriveProjectSummary({ project, passport });
    expect(explicit.metadata.consumes).toEqual([
      "Forever Passport",
      "Trust Intelligence",
      "Investment Intelligence",
      "Rental Intelligence",
      "Location Intelligence",
    ]);
  });

  it("handles partially populated project data without throwing", () => {
    expect(() =>
      summaryFor(makeProject({ units: [makeUnit({ type: "" })], investment: { rows: [] } })),
    ).not.toThrow();
  });
});
