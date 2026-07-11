import { describe, expect, it } from "vitest";

import { NOT_AVAILABLE } from "../investment-intelligence";
import { deriveForeverPassport } from "../forever-passport";
import { deriveProjectSummary } from "../project-summary";
import { deriveProjectRecommendations } from "../project-recommendations";
import type { ProjectDetail } from "@/features/project-detail/project-detail-types";
import { makeInvestmentRow, makeProject, makeUnit } from "./fixtures";

/**
 * A fully-populated project that pushes every foundation to its highest verdict.
 * Mirrors the rich fixture used by the Passport / Summary / Comparison suites.
 */
function makeRichProject(overrides: Parameters<typeof makeProject>[0] = {}): ProjectDetail {
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
    ],
    ...overrides,
  });
}

/** A verified-but-sparse project on a different slug → lower readiness. */
function makeSparseProject(): ProjectDetail {
  return makeProject({
    core: {
      name: "Coralina",
      slug: "coralina-layan",
      type: "Villa",
      location: "Layan",
      constructionStatus: "Planning",
      ownershipType: "",
    },
    developer: null,
  });
}

/** A mid-coverage project — foundational trust present, some depth missing. */
function makeMidProject(): ProjectDetail {
  return makeProject({
    core: {
      name: "Aster",
      slug: "aster-kamala",
      type: "Condominium",
      location: "Kamala",
      constructionStatus: "Planning",
      ownershipType: "Leasehold",
    },
    trust: {
      foreverVerified: true,
      trustScore: 40,
      verdict: "Forever Verified",
      marketPosition: "Mid segment",
      trustNote: "",
      lastInspection: "",
    },
  });
}

function passportFor(project: ProjectDetail) {
  return deriveForeverPassport(project);
}

// Matches invented-score / fabricated-metric shapes (X%, X/100, X/10, N points),
// without false-positiving on verified data like a "30/70" payment plan or an
// "N of Y signals" evidence-coverage count.
const NUMERIC_SCORE =
  /\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s*\/\s*(?:100|10)\b|\b\d+(?:\.\d+)?\s*points?\b/i;

describe("deriveProjectRecommendations — ranking", () => {
  it("orders candidates by evidence coverage, richest first, regardless of input order", () => {
    const rich = makeRichProject();
    const mid = makeMidProject();
    const sparse = makeSparseProject();

    const result = deriveProjectRecommendations({
      candidates: [{ project: sparse }, { project: rich }, { project: mid }],
    });

    expect(result.entries.map((e) => e.identity.projectSlug)).toEqual([
      "the-modeva-bang-tao",
      "aster-kamala",
      "coralina-layan",
    ]);
    expect(result.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(result.metadata.projects).toEqual([
      "the-modeva-bang-tao",
      "aster-kamala",
      "coralina-layan",
    ]);
  });

  it("names the rank-1 candidate as the leading recommendation", () => {
    const result = deriveProjectRecommendations({
      candidates: [{ project: makeSparseProject() }, { project: makeRichProject() }],
    });
    expect(result.topRecommendation?.projectSlug).toBe("the-modeva-bang-tao");
    expect(result.topRecommendation?.rank).toBe(1);
    expect(result.topRecommendation?.note).toMatch(/not project quality/i);
  });

  it("breaks ties deterministically on slug then name", () => {
    // Two evidence-equivalent sparse projects with different slugs.
    const a = makeProject({ core: { name: "Zeta", slug: "zeta" }, developer: null });
    const b = makeProject({ core: { name: "Alpha", slug: "alpha" }, developer: null });

    const first = deriveProjectRecommendations({
      candidates: [{ project: a }, { project: b }],
    });
    const second = deriveProjectRecommendations({
      candidates: [{ project: b }, { project: a }],
    });

    expect(first.entries.map((e) => e.identity.projectSlug)).toEqual(["alpha", "zeta"]);
    expect(second.entries.map((e) => e.identity.projectSlug)).toEqual(["alpha", "zeta"]);
  });

  it("does not mutate the caller's candidate array order", () => {
    const candidates = [{ project: makeSparseProject() }, { project: makeRichProject() }];
    const snapshot = candidates.map((c) => c.project.core.slug);
    deriveProjectRecommendations({ candidates });
    expect(candidates.map((c) => c.project.core.slug)).toEqual(snapshot);
  });
});

describe("deriveProjectRecommendations — reused, evidence-only values", () => {
  it("reuses the Passport overall readiness verdict verbatim (no second engine)", () => {
    const rich = makeRichProject();
    const result = deriveProjectRecommendations({ candidates: [{ project: rich }] });
    expect(result.entries[0].readinessVerdict).toBe(
      passportFor(rich).overallVerdict.readinessVerdict,
    );
    expect(result.entries[0].readinessRationale).toBe(passportFor(rich).overallVerdict.rationale);
  });

  it("reuses the Passport evidence-coverage counts verbatim", () => {
    const rich = makeRichProject();
    const passport = passportFor(rich);
    const result = deriveProjectRecommendations({ candidates: [{ project: rich }] });
    expect(result.entries[0].coverage.signalsPresent).toBe(
      passport.dataCompleteness.signalsPresent,
    );
    expect(result.entries[0].coverage.signalsTotal).toBe(passport.dataCompleteness.signalsTotal);
    expect(result.entries[0].coverage.recordedGaps).toBe(passport.combinedGaps.totalGaps);
  });

  it("reuses the Project Summary strengths / considerations verbatim", () => {
    const rich = makeRichProject();
    const passport = passportFor(rich);
    const summary = deriveProjectSummary({ project: rich, passport });
    const result = deriveProjectRecommendations({ candidates: [{ project: rich }] });
    expect(result.entries[0].strengths).toEqual(summary.strengths);
    expect(result.entries[0].considerations).toEqual(summary.considerations);
    expect(result.entries[0].suitability.statements).toEqual(summary.buyerProfile.statements);
  });

  it("derives Passport and Summary when not supplied", () => {
    const rich = makeRichProject();
    const sparse = makeSparseProject();
    const passportA = passportFor(rich);
    const passportB = passportFor(sparse);

    const derived = deriveProjectRecommendations({
      candidates: [{ project: rich }, { project: sparse }],
    });
    const explicit = deriveProjectRecommendations({
      candidates: [
        {
          project: rich,
          passport: passportA,
          summary: deriveProjectSummary({ project: rich, passport: passportA }),
        },
        {
          project: sparse,
          passport: passportB,
          summary: deriveProjectSummary({ project: sparse, passport: passportB }),
        },
      ],
    });
    expect(derived).toEqual(explicit);
  });

  it("names the three consumed layers and never a scoring engine", () => {
    const result = deriveProjectRecommendations({
      candidates: [{ project: makeRichProject() }, { project: makeSparseProject() }],
    });
    expect(result.metadata.consumes).toEqual([
      "Forever Passport",
      "Project Summary",
      "Project Comparison",
    ]);
    expect(result.metadata.source).toBe("advisory-project-recommendations");
  });
});

describe("deriveProjectRecommendations — head-to-head comparison reuse", () => {
  it("reuses the RC2.6 Project Comparison of the top two candidates", () => {
    const result = deriveProjectRecommendations({
      candidates: [{ project: makeSparseProject() }, { project: makeRichProject() }],
    });
    expect(result.comparison).not.toBeNull();
    // Top two, in ranked order: Modeva (A) vs Coralina (B).
    expect(result.comparison?.comparedProjects.a.projectSlug).toBe("the-modeva-bang-tao");
    expect(result.comparison?.comparedProjects.b.projectSlug).toBe("coralina-layan");
  });

  it("omits the head-to-head comparison when fewer than two candidates exist", () => {
    const result = deriveProjectRecommendations({ candidates: [{ project: makeRichProject() }] });
    expect(result.comparison).toBeNull();
  });
});

describe("deriveProjectRecommendations — missing data and edge cases", () => {
  it("handles an empty candidate set without throwing", () => {
    const result = deriveProjectRecommendations({ candidates: [] });
    expect(result.entries).toEqual([]);
    expect(result.topRecommendation).toBeNull();
    expect(result.comparison).toBeNull();
    expect(result.metadata.candidateCount).toBe(0);
    expect(result.headline.statements.length).toBeGreaterThan(0);
  });

  it("renders unavailable identity fields through the shared sentinel", () => {
    const bare = makeProject({
      core: { name: "Bare", slug: "bare-project", location: "", type: "" },
      developer: null,
    });
    const result = deriveProjectRecommendations({ candidates: [{ project: bare }] });
    expect(result.entries[0].identity.developerName).toBe(NOT_AVAILABLE);
    expect(result.entries[0].identity.location).toBe(NOT_AVAILABLE);
  });

  it("never throws on sparse or empty inputs", () => {
    expect(() =>
      deriveProjectRecommendations({
        candidates: [
          { project: makeProject({ units: [], investment: { rows: [] } }) },
          { project: makeProject({ core: { slug: "other" }, units: [] }) },
        ],
      }),
    ).not.toThrow();
  });
});

describe("deriveProjectRecommendations — anti-fabrication guarantees", () => {
  it("never emits a numeric score anywhere in the recommendation", () => {
    const result = deriveProjectRecommendations({
      candidates: [
        { project: makeRichProject() },
        { project: makeMidProject() },
        { project: makeSparseProject() },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(NUMERIC_SCORE);
  });

  it("never surfaces or reuses the hidden numeric trust score", () => {
    const result = deriveProjectRecommendations({
      candidates: [{ project: makeRichProject() }, { project: makeSparseProject() }],
    });
    expect(JSON.stringify(result)).not.toContain("88");
  });

  it("uses no promotional or sales language", () => {
    const result = deriveProjectRecommendations({
      candidates: [{ project: makeRichProject() }, { project: makeSparseProject() }],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /\b(best|luxury|stunning|amazing|must[- ]?(buy|have)|exclusive|unbeatable|guaranteed returns)\b/i,
    );
  });

  it("does not invent a buyer persona", () => {
    const result = deriveProjectRecommendations({
      candidates: [{ project: makeRichProject() }, { project: makeSparseProject() }],
    });
    expect(result.basis).toMatch(/never project quality/i);
    expect(JSON.stringify(result)).not.toMatch(/retiree|family|young|expat|millennial/i);
  });

  it("states that the order reflects data coverage, not quality", () => {
    const result = deriveProjectRecommendations({
      candidates: [{ project: makeRichProject() }, { project: makeSparseProject() }],
    });
    for (const entry of result.entries) {
      expect(entry.rationale).toMatch(/data coverage.*not project quality/i);
    }
  });
});

describe("deriveProjectRecommendations — deterministic", () => {
  it("produces identical output for identical inputs", () => {
    const build = () =>
      deriveProjectRecommendations({
        candidates: [{ project: makeRichProject() }, { project: makeSparseProject() }],
      });
    expect(build()).toEqual(build());
  });

  it("keeps a stable generation timestamp only when supplied", () => {
    const base = { candidates: [{ project: makeRichProject() }] };
    expect(deriveProjectRecommendations(base).metadata.generatedAt).toBe(NOT_AVAILABLE);
    expect(
      deriveProjectRecommendations({ ...base, generatedAt: "2026-07-11T00:00:00Z" }).metadata
        .generatedAt,
    ).toBe("2026-07-11T00:00:00Z");
  });

  it("keeps unique ranks and slugs across the ranked entries", () => {
    const result = deriveProjectRecommendations({
      candidates: [
        { project: makeRichProject() },
        { project: makeMidProject() },
        { project: makeSparseProject() },
      ],
    });
    const ranks = result.entries.map((e) => e.rank);
    const slugs = result.entries.map((e) => e.identity.projectSlug);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
