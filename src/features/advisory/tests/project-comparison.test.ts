import { describe, expect, it } from "vitest";

import { NOT_AVAILABLE } from "../investment-intelligence";
import { deriveForeverPassport } from "../forever-passport";
import { deriveProjectSummary } from "../project-summary";
import {
  deriveProjectComparison,
  type ComparisonRow,
  type ComparisonSetDiff,
} from "../project-comparison";
import type { ProjectDetail } from "@/features/project-detail/project-detail-types";
import { makeInvestmentRow, makeProject, makeUnit } from "./fixtures";

/**
 * A fully-populated project that pushes every foundation to its highest verdict.
 * Mirrors the rich fixture used by the Passport / Summary suites.
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

function passportFor(project: ProjectDetail) {
  return deriveForeverPassport(project);
}

// Matches invented-score / fabricated-metric shapes (X%, X/100, X/10, N points),
// without false-positiving on verified data like a "30/70" payment plan or an
// "N of Y signals" evidence-coverage count.
const NUMERIC_SCORE =
  /\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s*\/\s*(?:100|10)\b|\b\d+(?:\.\d+)?\s*points?\b/i;

/** All field-level comparison rows across the four domains. */
function allRows(comparison: ReturnType<typeof deriveProjectComparison>): ComparisonRow[] {
  return [
    ...comparison.trust.rows,
    ...comparison.investment.rows,
    ...comparison.rental.rows,
    ...comparison.location.rows,
  ];
}

/** Assert a set-diff never puts the same value in more than one bucket. */
function assertDisjoint(diff: ComparisonSetDiff) {
  const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());
  const shared = new Set(lower(diff.shared));
  const onlyA = new Set(lower(diff.onlyA));
  const onlyB = new Set(lower(diff.onlyB));
  for (const v of onlyA) {
    expect(shared.has(v)).toBe(false);
    expect(onlyB.has(v)).toBe(false);
  }
  for (const v of onlyB) {
    expect(shared.has(v)).toBe(false);
  }
  // No duplicates inside any single bucket.
  expect(new Set(lower(diff.shared)).size).toBe(diff.shared.length);
  expect(new Set(lower(diff.onlyA)).size).toBe(diff.onlyA.length);
  expect(new Set(lower(diff.onlyB)).size).toBe(diff.onlyB.length);
}

describe("deriveProjectComparison — compared projects", () => {
  it("reuses each project's Passport identity verbatim", () => {
    const a = makeRichProject();
    const b = makeSparseProject();
    const comparison = deriveProjectComparison({ a: { project: a }, b: { project: b } });

    expect(comparison.comparedProjects.a.projectName).toBe("Modeva");
    expect(comparison.comparedProjects.b.projectName).toBe("Coralina");
    expect(comparison.comparedProjects.a.projectSlug).toBe("the-modeva-bang-tao");
    expect(comparison.comparedProjects.b.projectSlug).toBe("coralina-layan");
    expect(comparison.comparedProjects.sameProject).toBe(false);
    expect(comparison.metadata.projects).toEqual(["the-modeva-bang-tao", "coralina-layan"]);
  });

  it("names the two consumed layers and never a scoring engine", () => {
    const comparison = deriveProjectComparison({
      a: { project: makeRichProject() },
      b: { project: makeSparseProject() },
    });
    expect(comparison.metadata.consumes).toEqual(["Forever Passport", "Project Summary"]);
    expect(comparison.metadata.source).toBe("advisory-project-comparison");
  });
});

describe("deriveProjectComparison — identical projects", () => {
  const project = makeRichProject();
  const comparison = deriveProjectComparison({
    a: { project },
    b: { project: makeRichProject() },
  });

  it("marks the pairing as the same project", () => {
    expect(comparison.comparedProjects.sameProject).toBe(true);
  });

  it("reports every field-level row as identical", () => {
    for (const row of allRows(comparison)) {
      expect(row.status).toBe("identical");
      expect(row.a).toBe(row.b);
    }
  });

  it("puts every strength / consideration in the shared bucket, none exclusive", () => {
    expect(comparison.strengths.onlyA).toEqual([]);
    expect(comparison.strengths.onlyB).toEqual([]);
    expect(comparison.considerations.onlyA).toEqual([]);
    expect(comparison.considerations.onlyB).toEqual([]);
  });

  it("reports readiness and evidence coverage as equal", () => {
    expect(comparison.decisionReadiness.lead).toBe("equal");
    expect(comparison.evidenceCompleteness.overall.lead).toBe("equal");
    expect(comparison.decisionReadiness.a).toBe(comparison.decisionReadiness.b);
  });

  it("has no exclusive data gaps between identical projects", () => {
    expect(comparison.passport.gaps.onlyA).toEqual([]);
    expect(comparison.passport.gaps.onlyB).toEqual([]);
  });
});

describe("deriveProjectComparison — different projects", () => {
  const rich = makeRichProject();
  const sparse = makeSparseProject();
  const comparison = deriveProjectComparison({
    a: { project: rich },
    b: { project: sparse },
  });

  it("surfaces differing field-level rows", () => {
    const differing = allRows(comparison).filter((r) => r.status !== "identical");
    expect(differing.length).toBeGreaterThan(0);
  });

  it("describes the readiness lead using the documented scale, not a score", () => {
    // The rich project is further along the readiness scale than the sparse one.
    expect(comparison.decisionReadiness.lead).toBe("a");
    expect(comparison.decisionReadiness.a).toBe(passportFor(rich).overallVerdict.readinessVerdict);
    expect(comparison.decisionReadiness.b).toBe(
      passportFor(sparse).overallVerdict.readinessVerdict,
    );
    expect(comparison.decisionReadiness.note).toMatch(/not project quality/i);
  });

  it("describes evidence coverage as data presence, not quality", () => {
    expect(comparison.evidenceCompleteness.overall.lead).toBe("a");
    expect(comparison.evidenceCompleteness.overall.aPresent).toBeGreaterThan(
      comparison.evidenceCompleteness.overall.bPresent,
    );
    expect(comparison.evidenceCompleteness.note).toMatch(/data coverage only, not quality/i);
  });

  it("counts a strength held only by the richer record as exclusive to A", () => {
    // Both projects are Forever Verified in the fixture default → that strength
    // is shared; pricing verification and rental evidence are exclusive to A.
    expect(comparison.strengths.shared).toContain("Forever Verified project record.");
    expect(comparison.strengths.onlyA).toContain("Independently verified pricing.");
    expect(comparison.strengths.onlyB).toEqual([]);
  });
});

describe("deriveProjectComparison — missing fields", () => {
  const a = makeRichProject();
  // B has no developer, no verdict, no pricing → many present-in-a rows.
  const b = makeProject({
    core: { name: "Bare", slug: "bare-project", location: "" },
    developer: null,
  });
  const comparison = deriveProjectComparison({ a: { project: a }, b: { project: b } });

  it("renders unavailable values through the shared sentinel", () => {
    const priceRow = comparison.investment.rows.find((r) => r.key === "entryPrice");
    expect(priceRow?.a).not.toBe(NOT_AVAILABLE);
    expect(priceRow?.b).toBe(NOT_AVAILABLE);
    expect(priceRow?.status).toBe("present-in-a");
  });

  it("marks a field absent in both as absent-in-both", () => {
    // Neither project records a market position in this pairing.
    const bare = makeProject({ core: { slug: "bare-project" }, trust: { marketPosition: "" } });
    const richNoMarket = makeRichProject({ trust: { marketPosition: "" } });
    const c = deriveProjectComparison({
      a: { project: richNoMarket },
      b: { project: bare },
    });
    const row = c.trust.rows.find((r) => r.key === "marketPosition");
    expect(row?.status).toBe("absent-in-both");
    expect(row?.a).toBe(NOT_AVAILABLE);
    expect(row?.b).toBe(NOT_AVAILABLE);
  });

  it("never throws on sparse or empty inputs", () => {
    expect(() =>
      deriveProjectComparison({
        a: { project: makeProject({ units: [], investment: { rows: [] } }) },
        b: { project: makeProject({ core: { slug: "other" }, units: [] }) },
      }),
    ).not.toThrow();
  });
});

describe("deriveProjectComparison — reuse of already-derived outputs", () => {
  it("derives the Passport when it is not supplied (missing Passport)", () => {
    const a = makeRichProject();
    const b = makeSparseProject();

    const derived = deriveProjectComparison({ a: { project: a }, b: { project: b } });
    const explicit = deriveProjectComparison({
      a: { project: a, passport: passportFor(a) },
      b: { project: b, passport: passportFor(b) },
    });
    expect(derived).toEqual(explicit);
  });

  it("derives the Project Summary when it is not supplied (missing Summary)", () => {
    const a = makeRichProject();
    const b = makeSparseProject();
    const passportA = passportFor(a);
    const passportB = passportFor(b);

    const derived = deriveProjectComparison({
      a: { project: a, passport: passportA },
      b: { project: b, passport: passportB },
    });
    const explicit = deriveProjectComparison({
      a: {
        project: a,
        passport: passportA,
        summary: deriveProjectSummary({ project: a, passport: passportA }),
      },
      b: {
        project: b,
        passport: passportB,
        summary: deriveProjectSummary({ project: b, passport: passportB }),
      },
    });
    expect(derived).toEqual(explicit);
  });

  it("reuses the Passport readiness verdict verbatim (no second readiness engine)", () => {
    const a = makeRichProject();
    const b = makeSparseProject();
    const comparison = deriveProjectComparison({ a: { project: a }, b: { project: b } });

    expect(comparison.decisionReadiness.a).toBe(passportFor(a).overallVerdict.readinessVerdict);
    expect(comparison.decisionReadiness.rationaleA).toBe(passportFor(a).overallVerdict.rationale);
    expect(comparison.passport.overallReadiness.b).toBe(
      passportFor(b).overallVerdict.readinessVerdict,
    );
  });
});

describe("deriveProjectComparison — anti-fabrication guarantees", () => {
  it("never emits a numeric score anywhere in the comparison", () => {
    for (const [a, b] of [
      [makeRichProject(), makeSparseProject()],
      [makeProject(), makeProject({ core: { slug: "other" } })],
    ] as const) {
      const comparison = deriveProjectComparison({ a: { project: a }, b: { project: b } });
      expect(JSON.stringify(comparison)).not.toMatch(NUMERIC_SCORE);
    }
  });

  it("never surfaces or reuses the hidden numeric trust score", () => {
    const comparison = deriveProjectComparison({
      a: { project: makeRichProject() }, // trustScore 88
      b: { project: makeSparseProject() },
    });
    expect(JSON.stringify(comparison)).not.toContain("88");
  });

  it("uses no promotional or sales language", () => {
    const comparison = deriveProjectComparison({
      a: { project: makeRichProject() },
      b: { project: makeSparseProject() },
    });
    expect(JSON.stringify(comparison)).not.toMatch(
      /\b(best|luxury|stunning|amazing|must[- ]?(buy|have)|exclusive|unbeatable|guaranteed returns)\b/i,
    );
  });

  it("does not invent a buyer persona", () => {
    const comparison = deriveProjectComparison({
      a: { project: makeRichProject() },
      b: { project: makeSparseProject() },
    });
    expect(comparison.buyerProfile.basis).toMatch(/no demographic persona/i);
    expect(JSON.stringify(comparison.buyerProfile)).not.toMatch(
      /retiree|family|young|expat|millennial/i,
    );
  });
});

describe("deriveProjectComparison — no duplicate comparison entries", () => {
  const comparison = deriveProjectComparison({
    a: { project: makeRichProject() },
    b: { project: makeSparseProject() },
  });

  it("keeps unique row keys within every domain comparison", () => {
    for (const domain of [
      comparison.trust,
      comparison.investment,
      comparison.rental,
      comparison.location,
    ]) {
      const keys = domain.rows.map((r) => r.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("keeps every set-diff bucket disjoint and internally deduplicated", () => {
    assertDisjoint(comparison.strengths);
    assertDisjoint(comparison.considerations);
    assertDisjoint(comparison.buyerProfile.diff);
    assertDisjoint(comparison.passport.gaps);
  });
});

describe("deriveProjectComparison — deterministic and ordered", () => {
  it("produces identical output for identical inputs", () => {
    const a = deriveProjectComparison({
      a: { project: makeRichProject() },
      b: { project: makeSparseProject() },
    });
    const b = deriveProjectComparison({
      a: { project: makeRichProject() },
      b: { project: makeSparseProject() },
    });
    expect(a).toEqual(b);
  });

  it("keeps a stable foundation order in the evidence-completeness comparison", () => {
    const comparison = deriveProjectComparison({
      a: { project: makeRichProject() },
      b: { project: makeSparseProject() },
    });
    expect(comparison.evidenceCompleteness.byFoundation.map((r) => r.key)).toEqual([
      "trust",
      "investment",
      "rental",
      "location",
    ]);
  });

  it("keeps a stable generation timestamp only when supplied", () => {
    const base = { a: { project: makeRichProject() }, b: { project: makeSparseProject() } };
    expect(deriveProjectComparison(base).metadata.generatedAt).toBe(NOT_AVAILABLE);
    expect(
      deriveProjectComparison({ ...base, generatedAt: "2026-07-11T00:00:00Z" }).metadata
        .generatedAt,
    ).toBe("2026-07-11T00:00:00Z");
  });
});
