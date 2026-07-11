import { describe, expect, it } from "vitest";

import { deriveAdvisorReport } from "../advisor-report";
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
          guaranteedRentalPercent: 6,
          guaranteeYears: 3,
          managementCompany: "Forever Rentals",
        }),
      ],
    },
    location: {
      area: "Bang Tao",
      distanceToBeach: "500 m",
      lifestyle: ["Beach club"],
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

/** Build a report for one project, with optional comparison + recommendations. */
function buildReport(
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
    report: deriveAdvisorReport({
      project,
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

describe("deriveAdvisorReport", () => {
  it("1. composes a complete report from a rich project", () => {
    const { report } = buildReport(makeRichProject(), {
      comparison: true,
      recommendations: true,
    });
    expect(report.cover.reportTitle).toBe("Forever Advisor Report");
    expect(report.cover.brand).toBe("Forever");
    expect(report.cover.projectName).toBe("Modeva");
    expect(report.strengths.length).toBeGreaterThan(0);
    expect(report.investment).toBeDefined();
    expect(report.rental).toBeDefined();
    expect(report.location).toBeDefined();
    expect(report.comparison).toBeDefined();
    expect(report.recommendations).toBeDefined();
  });

  it("2. renders safely with sparse / partial project data", () => {
    const { report } = buildReport(makeSparseProject());
    expect(report.cover.projectName).toBe("Coralina");
    // Developer is absent -> the shared unavailable convention is used.
    expect(report.identity.identity.developerName).toBe("Not available");
    expect(report.metadata.readinessVerdict).toBe("Insufficient verified data");
  });

  it("3. omits optional sections when their data is unavailable", () => {
    const { report } = buildReport(makeRichProject());
    expect(report.comparison).toBeUndefined();
    expect(report.recommendations).toBeUndefined();
    expect(report.sections).not.toContain("comparison");
    expect(report.sections).not.toContain("recommendations");
    expect(Object.prototype.hasOwnProperty.call(report, "comparison")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(report, "recommendations")).toBe(false);
  });

  it("3b. includes optional sections in ordering when data is present", () => {
    const { report } = buildReport(makeRichProject(), {
      comparison: true,
      recommendations: true,
    });
    expect(report.sections).toContain("comparison");
    expect(report.sections).toContain("recommendations");
  });

  it("4. reuses the Passport readiness verdict verbatim (no new verdict)", () => {
    const { report, passport } = buildReport(makeRichProject());
    expect(report.executiveOverview.readinessVerdict).toBe(
      passport.overallVerdict.readinessVerdict,
    );
    expect(report.executiveOverview.readinessRationale).toBe(passport.overallVerdict.rationale);
    expect(report.metadata.readinessVerdict).toBe(passport.overallVerdict.readinessVerdict);
  });

  it("5. reuses the Summary facts, overview, strengths, considerations and buyer profile", () => {
    const { report, summary } = buildReport(makeRichProject());
    expect(report.identity.keyFacts).toBe(summary.keyFacts);
    expect(report.executiveOverview.overviewHeadline).toBe(summary.overview.headline);
    expect(report.executiveOverview.signals).toBe(summary.overview.signals);
    expect(report.strengths).toBe(summary.strengths);
    expect(report.considerations).toBe(summary.considerations);
    expect(report.buyerProfile).toBe(summary.buyerProfile);
  });

  it("6. reuses the Comparison output verbatim (no recalculation)", () => {
    const { report, comparison } = buildReport(makeRichProject(), { comparison: true });
    expect(report.comparison).toBe(comparison);
  });

  it("7. reuses the Recommendations output without reordering", () => {
    const { report, recommendations } = buildReport(makeRichProject(), {
      recommendations: true,
    });
    expect(report.recommendations).toBe(recommendations);
    expect(report.recommendations?.entries.map((e) => e.identity.projectSlug)).toEqual(
      recommendations?.entries.map((e) => e.identity.projectSlug),
    );
  });

  it("8. never exposes the hidden numeric trustScore", () => {
    const { report } = buildReport(makeRichProject(), {
      comparison: true,
      recommendations: true,
    });
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain("trustScore");
    // The raw 88 trust score value must never surface anywhere.
    expect(serialised).not.toContain("88");
    expect(report.trust).not.toHaveProperty("trustScore");
  });

  it("9. never fabricates a numeric quality score", () => {
    const { report } = buildReport(makeRichProject());
    expect(report).not.toHaveProperty("score");
    expect(report.metadata).not.toHaveProperty("score");
    // Only sentinel score-status strings are carried through, never numbers.
    expect(report.investment.investmentScore).toBe("Investment score not available");
    expect(report.rental.rentalScore).toBe("Rental score not available");
    expect(report.location.locationScore).toBe("Location score not available");
  });

  it("10. never fabricates a financial metric on the report itself", () => {
    const { report } = buildReport(makeRichProject());
    // The report adds no financial fields of its own; it only carries the derived
    // Investment/Rental/Location outputs verbatim.
    expect(report).not.toHaveProperty("roi");
    expect(report).not.toHaveProperty("yield");
    expect(report).not.toHaveProperty("appreciation");
    expect(report.executiveOverview).not.toHaveProperty("yield");
  });

  it('11. uses the shared "Not available" convention for missing values', () => {
    const { report } = buildReport(makeSparseProject());
    expect(report.identity.identity.developerName).toBe("Not available");
    expect(report.buyerProfile.unavailableLabel).toBe("Not available");
  });

  it("12. surfaces the report date only when generatedAt is supplied", () => {
    const withDate = buildReport(makeRichProject(), { generatedAt: "2026-07-11" }).report;
    expect(withDate.cover.reportDate).toBe("2026-07-11");
    expect(withDate.metadata.generatedAt).toBe("2026-07-11");

    const withoutDate = buildReport(makeRichProject()).report;
    expect(withoutDate.cover.reportDate).toBeUndefined();
    expect(withoutDate.metadata.generatedAt).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(withoutDate.cover, "reportDate")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(withoutDate.metadata, "generatedAt")).toBe(false);
  });

  it("13. is deterministic for identical inputs", () => {
    const a = buildReport(makeRichProject(), {
      comparison: true,
      recommendations: true,
      generatedAt: "2026-07-11",
    }).report;
    const b = buildReport(makeRichProject(), {
      comparison: true,
      recommendations: true,
      generatedAt: "2026-07-11",
    }).report;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("16. presents sections in the correct, stable order", () => {
    const { report } = buildReport(makeRichProject(), {
      comparison: true,
      recommendations: true,
    });
    expect(report.sections).toEqual([
      "cover",
      "executive-overview",
      "identity",
      "strengths",
      "considerations",
      "buyer-profile",
      "investment",
      "rental",
      "location",
      "trust",
      "comparison",
      "recommendations",
      "data-limitations",
      "disclaimer",
    ]);
  });

  it("13b. deduplicates data limitations from Passport + Summary without inventing gaps", () => {
    const { report, passport, summary } = buildReport(makeSparseProject());
    const union = [...passport.combinedGaps.combined, ...summary.dataLimitations];
    // Every reported limitation must trace back to an existing gap.
    for (const gap of report.dataLimitations) {
      expect(union).toContain(gap);
    }
    // No duplicates (case-insensitive).
    const lowered = report.dataLimitations.map((g) => g.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });

  it("17. contains no promotional wording", () => {
    const { report } = buildReport(makeRichProject(), {
      comparison: true,
      recommendations: true,
    });
    const serialised = JSON.stringify(report).toLowerCase();
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

  it("carries the evidence-only disclaimer on the cover and advisory disclaimers", () => {
    const { report } = buildReport(makeRichProject());
    expect(report.cover.disclaimer).toMatch(/not available/i);
    expect(report.disclaimer.statements.length).toBeGreaterThan(0);
    expect(report.disclaimer.statements.join(" ")).toMatch(/due diligence/i);
  });
});
