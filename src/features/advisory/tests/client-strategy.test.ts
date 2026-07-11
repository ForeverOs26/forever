import { describe, expect, it } from "vitest";

import { deriveClientStrategy } from "../client-strategy";
import { deriveForeverPassport } from "../forever-passport";
import { deriveInvestmentIntelligence } from "../investment-intelligence";
import { deriveLocationIntelligence } from "../location-intelligence";
import { deriveProjectComparison } from "../project-comparison";
import { deriveProjectRecommendations } from "../project-recommendations";
import { deriveProjectSummary } from "../project-summary";
import { deriveRentalIntelligence } from "../rental-intelligence";
import type { ProjectDetail } from "@/features/project-detail/project-detail-types";
import { makeInvestmentRow, makeProject, makeUnit } from "./fixtures";

/** A verified, evidence-rich primary project. */
function makeRichProject(): ProjectDetail {
  return makeProject({
    core: {
      name: "Modeva",
      slug: "the-modeva-bang-tao",
      type: "Condominium",
      location: "Bang Tao",
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
          annualRoiPercent: 7,
          guaranteedRentalPercent: 6,
          guaranteeYears: 3,
          managementCompany: "Forever Rentals",
        }),
      ],
    },
    location: {
      area: "Bang Tao",
      distanceToBeach: "500 m",
      distanceToAirport: "25 km",
      lifestyle: ["Beach club"],
      nearbySchools: ["UWC Thailand"],
    },
    units: [makeUnit({ basePriceTHB: 5_000_000, rentalGuarantee: "6% for 3 years" })],
  });
}

/** A sparse, mostly-unverified secondary project. */
function makeSparseProject(): ProjectDetail {
  return makeProject({
    core: { name: "Coralina", slug: "coralina-layan", type: "Villa", location: "Layan" },
    trust: { foreverVerified: false, trustScore: 0 },
    developer: null,
  });
}

/** Build a strategy for one project, with optional comparison + recommendations. */
function buildStrategy(
  project: ProjectDetail,
  opts: { comparison?: boolean; recommendations?: boolean; generatedAt?: string } = {},
) {
  const investment = deriveInvestmentIntelligence(project);
  const rental = deriveRentalIntelligence(project);
  const location = deriveLocationIntelligence(project);
  const passport = deriveForeverPassport(project);
  const summary = deriveProjectSummary({ project, passport, investment, rental, location });

  const other = makeSparseProject();
  const comparison = opts.comparison
    ? deriveProjectComparison({ a: { project, passport, summary }, b: { project: other } })
    : undefined;
  const recommendations = opts.recommendations
    ? deriveProjectRecommendations({
        candidates: [{ project, passport, summary }, { project: other }],
      })
    : undefined;

  return {
    passport,
    summary,
    investment,
    rental,
    location,
    comparison,
    recommendations,
    strategy: deriveClientStrategy({
      passport,
      summary,
      investment,
      rental,
      location,
      comparison,
      recommendations,
      generatedAt: opts.generatedAt,
    }),
  };
}

describe("deriveClientStrategy", () => {
  it("1. composes all six strategy sections from a rich project", () => {
    const { strategy } = buildStrategy(makeRichProject(), {
      comparison: true,
      recommendations: true,
    });
    expect(strategy.sections).toEqual([
      "investment",
      "purchase",
      "rental",
      "exit",
      "risk",
      "action-plan",
    ]);
    expect(strategy.investment.title).toBe("Investment Strategy");
    expect(strategy.purchase.title).toBe("Purchase Strategy");
    expect(strategy.rental.title).toBe("Rental Strategy");
    expect(strategy.exit.title).toBe("Exit Strategy");
    expect(strategy.risk.title).toBe("Risk Strategy");
    expect(strategy.actionPlan.title).toBe("Action Plan");
  });

  it("2. reuses the foundation readiness verdicts verbatim (no new verdict)", () => {
    const { strategy, passport } = buildStrategy(makeRichProject());
    expect(strategy.investment.readinessVerdict).toBe(passport.investment.readinessVerdict);
    expect(strategy.rental.readinessVerdict).toBe(passport.rental.readinessVerdict);
    // Sections without a mapped foundation verdict never invent one.
    expect(strategy.purchase.readinessVerdict).toBeUndefined();
    expect(strategy.exit.readinessVerdict).toBeUndefined();
    expect(strategy.risk.readinessVerdict).toBeUndefined();
    expect(strategy.actionPlan.readinessVerdict).toBeUndefined();
    // The overall readiness mirrored in metadata comes straight from the Passport.
    expect(strategy.metadata.readinessVerdict).toBe(passport.overallVerdict.readinessVerdict);
  });

  it("3. reuses derived evidence values verbatim, never recomputing them", () => {
    const { strategy, investment, rental, location, passport } = buildStrategy(makeRichProject());
    const investmentValues = strategy.investment.points.map((p) => p.value);
    expect(investmentValues).toContain(investment.entryPrice);
    expect(investmentValues).toContain(investment.priceVerificationStatus);
    expect(investmentValues).toContain(passport.investment.verdictRationale);

    const rentalValues = strategy.rental.points.map((p) => p.value);
    expect(rentalValues).toContain(rental.demandContext);
    expect(rentalValues).toContain(rental.guaranteeEvidence);

    const exitValues = strategy.exit.points.map((p) => p.value);
    expect(exitValues).toContain(location.resaleLocationEvidence);
    expect(exitValues).toContain(investment.liquidityEvidence);
  });

  it("4. reuses the Summary considerations verbatim in the Risk Strategy", () => {
    const { strategy, summary } = buildStrategy(makeRichProject());
    for (const item of strategy.risk.considerations) {
      expect(summary.considerations).toContain(item);
    }
  });

  it("5. the Action Plan reuses the Passport combined gaps verbatim", () => {
    const { strategy, passport } = buildStrategy(makeSparseProject());
    expect(strategy.actionPlan.considerations).toEqual(passport.combinedGaps.combined);
  });

  it("6. every foundation data gap it lists traces back to a derived gap", () => {
    const { strategy, investment, rental } = buildStrategy(makeSparseProject());
    for (const gap of strategy.investment.considerations) {
      expect(investment.keyDataGaps).toContain(gap);
    }
    for (const gap of strategy.rental.considerations) {
      expect(rental.keyDataGaps).toContain(gap);
    }
  });

  it("7. never exposes the hidden numeric trustScore or its raw value", () => {
    const { strategy } = buildStrategy(makeRichProject(), {
      comparison: true,
      recommendations: true,
    });
    const serialised = JSON.stringify(strategy);
    expect(serialised).not.toContain("trustScore");
    // The raw 88 trust score value must never surface anywhere.
    expect(serialised).not.toContain("88");
  });

  it("8. never fabricates a numeric quality or financial score", () => {
    const { strategy } = buildStrategy(makeRichProject());
    expect(strategy).not.toHaveProperty("score");
    expect(strategy.metadata).not.toHaveProperty("score");
    for (const section of [
      strategy.investment,
      strategy.purchase,
      strategy.rental,
      strategy.exit,
      strategy.risk,
      strategy.actionPlan,
    ]) {
      expect(section).not.toHaveProperty("score");
      expect(section).not.toHaveProperty("roi");
      expect(section).not.toHaveProperty("yield");
      expect(section).not.toHaveProperty("appreciation");
    }
  });

  it("9. adds no financial metric fields of its own", () => {
    const { strategy } = buildStrategy(makeRichProject());
    for (const banned of ["roi", "yield", "appreciation", "forecast", "matchScore"]) {
      expect(strategy).not.toHaveProperty(banned);
    }
  });

  it('10. uses the shared "Not available" convention for missing evidence', () => {
    const { strategy } = buildStrategy(makeSparseProject());
    const serialised = JSON.stringify(strategy);
    expect(serialised).toContain("Not available");
    // A sparse project has no verified rental income evidence → Not available.
    const income = strategy.rental.points.find((p) => p.label === "Income evidence");
    expect(income?.value).toBe("Not available");
  });

  it("11. marks a section unavailable only when it has no evidence and no considerations", () => {
    const { strategy } = buildStrategy(makeRichProject());
    // The rich project has strengths but no considerations → Risk Strategy still
    // has readiness points, so it stays available.
    expect(strategy.risk.available).toBe(true);
    // Action Plan is always available (carries the readiness statement + step).
    expect(strategy.actionPlan.available).toBe(true);
  });

  it("12. records optional consumed outputs only when supplied", () => {
    const withAll = buildStrategy(makeRichProject(), {
      comparison: true,
      recommendations: true,
    }).strategy;
    expect(withAll.metadata.consumes).toContain("project-comparison");
    expect(withAll.metadata.consumes).toContain("project-recommendations");

    const withoutOptional = buildStrategy(makeRichProject()).strategy;
    expect(withoutOptional.metadata.consumes).not.toContain("project-comparison");
    expect(withoutOptional.metadata.consumes).not.toContain("project-recommendations");
  });

  it("13. surfaces a leading-candidate action only when recommendations are supplied", () => {
    const withRecs = buildStrategy(makeRichProject(), { recommendations: true }).strategy;
    const lead = withRecs.actionPlan.points.find(
      (p) => p.label === "Leading candidate (evidence coverage)",
    );
    expect(lead).toBeDefined();

    const withoutRecs = buildStrategy(makeRichProject()).strategy;
    expect(
      withoutRecs.actionPlan.points.find(
        (p) => p.label === "Leading candidate (evidence coverage)",
      ),
    ).toBeUndefined();
  });

  it("14. surfaces the generation timestamp only when generatedAt is supplied", () => {
    const withDate = buildStrategy(makeRichProject(), { generatedAt: "2026-07-11" }).strategy;
    expect(withDate.metadata.generatedAt).toBe("2026-07-11");

    const withoutDate = buildStrategy(makeRichProject()).strategy;
    expect(withoutDate.metadata.generatedAt).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(withoutDate.metadata, "generatedAt")).toBe(false);
  });

  it("15. is deterministic for identical inputs", () => {
    const a = buildStrategy(makeRichProject(), {
      comparison: true,
      recommendations: true,
      generatedAt: "2026-07-11",
    }).strategy;
    const b = buildStrategy(makeRichProject(), {
      comparison: true,
      recommendations: true,
      generatedAt: "2026-07-11",
    }).strategy;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("16. carries stable provenance metadata", () => {
    const { strategy } = buildStrategy(makeRichProject());
    expect(strategy.metadata.source).toBe("advisory-client-strategy");
    expect(strategy.metadata.schemaVersion).toBe("1.0");
    expect(strategy.metadata.strategyVersion).toBe("1.0");
    expect(strategy.metadata.projectSlug).toBe("the-modeva-bang-tao");
    expect(strategy.metadata.projectName).toBe("Modeva");
    expect(strategy.metadata.consumes).toEqual([
      "forever-passport",
      "project-summary",
      "investment-intelligence",
      "rental-intelligence",
      "location-intelligence",
    ]);
  });

  it("17. contains no promotional wording", () => {
    const { strategy } = buildStrategy(makeRichProject(), {
      comparison: true,
      recommendations: true,
    });
    const serialised = JSON.stringify(strategy).toLowerCase();
    for (const banned of [
      "best investment",
      "safe investment",
      "guaranteed return",
      "guaranteed profit",
      "risk-free",
      "once in a lifetime",
      "must buy",
      "unbeatable",
    ]) {
      expect(serialised).not.toContain(banned);
    }
  });

  it("18. renders safely for a fully sparse project (missing data → Not available)", () => {
    const { strategy } = buildStrategy(makeSparseProject());
    expect(strategy.metadata.readinessVerdict).toBe("Insufficient verified data");
    // The immediate step reflects the sparse readiness stage.
    const step = strategy.actionPlan.points.find((p) => p.label === "Immediate step");
    expect(step?.value).toMatch(/foundational evidence/i);
  });
});
