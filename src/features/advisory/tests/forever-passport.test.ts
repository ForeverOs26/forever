import { describe, expect, it } from "vitest";

import { NOT_AVAILABLE } from "../investment-intelligence";
import { deriveForeverPassport } from "../forever-passport";
import { makeInvestmentRow, makeProject, makeUnit } from "./fixtures";

/**
 * A fully-populated project that pushes every foundation to its highest verdict.
 * Used to prove the Passport aggregates real evidence without inventing scores.
 */
function makeRichProject() {
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
        basePriceTHB: 5_000_000,
        rentalGuarantee: "6% for 3 years",
        availabilityStatus: "available",
      }),
      makeUnit({ id: "unit-2", basePriceTHB: 6_000_000, availabilityStatus: "sold" }),
    ],
  });
}

describe("deriveForeverPassport — sparse (verified Modeva-like) record", () => {
  const passport = deriveForeverPassport(makeProject());

  it("surfaces project identity from verified core fields", () => {
    expect(passport.identity.projectName).toBe("Modeva");
    expect(passport.identity.projectSlug).toBe("the-modeva-bang-tao");
    expect(passport.identity.foreverId).toBe("the-modeva-bang-tao");
    expect(passport.identity.propertyType).toBe("Condominium");
    expect(passport.identity.location).toBe("Bang Tao");
    expect(passport.identity.developerName).toBe("Title");
  });

  it("marks unsupported identity fields as 'Not available'", () => {
    const passportNoDev = deriveForeverPassport(makeProject({ developer: null }));
    expect(passportNoDev.identity.developerName).toBe(NOT_AVAILABLE);
  });

  it("aggregates the four foundation readiness verdicts", () => {
    expect(passport.overallVerdict.byFoundation.map((row) => row.key)).toEqual([
      "trust",
      "investment",
      "rental",
      "location",
    ]);
  });

  it("computes overall verdict as the most conservative of the four", () => {
    // The sparse fixture has insufficient investment/rental data.
    expect(passport.overallVerdict.readinessVerdict).toBe("Insufficient verified data");
    expect(passport.overallVerdict.rationale).toContain("most conservative");
  });
});

describe("deriveForeverPassport — no fabricated scores", () => {
  it("never surfaces a numeric score and never reuses trustScore", () => {
    const trustScore = 88;
    const passport = deriveForeverPassport(makeRichProject());
    const serialized = JSON.stringify(passport);

    // The raw trust score value must not leak anywhere in the passport.
    expect(serialized).not.toContain(String(trustScore));
    // Every foundation surfaces only its "score not available" sentinel.
    expect(passport.investment.scoreStatus).toBe("Investment score not available");
    expect(passport.rental.scoreStatus).toBe("Rental score not available");
    expect(passport.location.scoreStatus).toBe("Location score not available");
    // The passport itself owns no numeric overall/aggregate score field.
    expect(passport).not.toHaveProperty("overallScore");
    expect(passport).not.toHaveProperty("score");
    expect(passport.trust).not.toHaveProperty("trustScore");
  });

  it("data completeness is a presence count, not an averaged rating", () => {
    const passport = deriveForeverPassport(makeProject());
    const { dataCompleteness } = passport;
    // 5 trust + 6 investment + 6 rental + 6 location = 23 possible signals.
    expect(dataCompleteness.signalsTotal).toBe(23);
    expect(dataCompleteness.signalsPresent).toBeLessThanOrEqual(dataCompleteness.signalsTotal);
    expect(dataCompleteness.percentComplete).toBe(
      Math.round((dataCompleteness.signalsPresent / dataCompleteness.signalsTotal) * 100),
    );
    const summed = dataCompleteness.byFoundation.reduce((n, r) => n + r.signalsPresent, 0);
    expect(summed).toBe(dataCompleteness.signalsPresent);
  });
});

describe("deriveForeverPassport — consumes existing derivation layers", () => {
  it("mirrors each foundation's own readiness verdict exactly", () => {
    const project = makeRichProject();
    const passport = deriveForeverPassport(project);

    // The summaries carry the same verdicts the foundations produce.
    expect(passport.trust.readinessVerdict).toBe("Ready for preliminary review");
    expect(passport.investment.readinessVerdict).toBe("Ready for preliminary review");
    expect(passport.rental.readinessVerdict).toBe("Ready for preliminary review");
    expect(passport.location.readinessVerdict).toBe("Ready for preliminary review");
    expect(passport.overallVerdict.readinessVerdict).toBe("Ready for preliminary review");
  });

  it("combines each foundation's key data gaps with a domain prefix", () => {
    const passport = deriveForeverPassport(makeProject());
    // Every combined gap is prefixed with its foundation label.
    for (const gap of passport.combinedGaps.combined) {
      expect(gap).toMatch(/^(Trust|Investment|Rental|Location) Intelligence: /);
    }
    // Domain order is deterministic: trust gaps come before investment, etc.
    const firstInvestment = passport.combinedGaps.combined.findIndex((g) =>
      g.startsWith("Investment Intelligence:"),
    );
    const firstRental = passport.combinedGaps.combined.findIndex((g) =>
      g.startsWith("Rental Intelligence:"),
    );
    expect(firstInvestment).toBeLessThan(firstRental);
    expect(passport.combinedGaps.totalGaps).toBe(passport.combinedGaps.combined.length);
  });

  it("reports evidence coverage per foundation with its source", () => {
    const passport = deriveForeverPassport(makeRichProject());
    expect(passport.evidenceCoverage.foundationsTotal).toBe(4);
    expect(passport.evidenceCoverage.foundationsReady).toBe(4);
    const investmentRow = passport.evidenceCoverage.foundations.find((r) => r.key === "investment");
    expect(investmentRow?.source).toBe("deriveInvestmentIntelligence(project)");
  });
});

describe("deriveForeverPassport — overall verdict determinism (most conservative)", () => {
  it("drops to the lowest verdict when one foundation is insufficient", () => {
    // Rich everywhere EXCEPT trust (no verdict → trust insufficient).
    const project = makeRichProject();
    project.trust.verdict = "";
    project.trust.foreverVerified = true;
    const passport = deriveForeverPassport(project);

    expect(passport.trust.readinessVerdict).toBe("Insufficient verified data");
    expect(passport.overallVerdict.readinessVerdict).toBe("Insufficient verified data");
  });

  it("is 'More evidence required' when the lowest foundation is that tier", () => {
    // Location with name + address only → "More evidence required" at best,
    // while other foundations are ready.
    const project = makeRichProject();
    project.location = {
      area: "Bang Tao",
      latitude: null,
      longitude: null,
      distanceToBeach: "",
      distanceToAirport: "",
      nearbySchools: [],
      nearbyHospitals: [],
      lifestyle: [],
    };
    const passport = deriveForeverPassport(project);
    expect(passport.location.readinessVerdict).toBe("More evidence required");
    expect(passport.overallVerdict.readinessVerdict).toBe("More evidence required");
  });
});

describe("deriveForeverPassport — metadata", () => {
  it("records deterministic provenance and never invents a timestamp", () => {
    const passport = deriveForeverPassport(makeProject());
    expect(passport.metadata.schemaVersion).toBe("1.0");
    expect(passport.metadata.passportVersion).toBe("1.0");
    expect(passport.metadata.source).toBe("advisory-intelligence-foundations");
    expect(passport.metadata.projectSlug).toBe("the-modeva-bang-tao");
    expect(passport.metadata.foundationsConsumed).toEqual([
      "Trust Intelligence",
      "Investment Intelligence",
      "Rental Intelligence",
      "Location Intelligence",
    ]);
    // No caller timestamp supplied → not fabricated.
    expect(passport.metadata.generatedAt).toBe(NOT_AVAILABLE);
  });

  it("surfaces a caller-supplied generatedAt verbatim", () => {
    const passport = deriveForeverPassport(makeProject(), { generatedAt: "2026-07-11T00:00:00Z" });
    expect(passport.metadata.generatedAt).toBe("2026-07-11T00:00:00Z");
  });
});

describe("deriveForeverPassport — determinism", () => {
  it("produces identical output for identical input", () => {
    const project = makeRichProject();
    const first = deriveForeverPassport(project, { generatedAt: "2026-07-11T00:00:00Z" });
    const second = deriveForeverPassport(project, { generatedAt: "2026-07-11T00:00:00Z" });
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
  });
});
