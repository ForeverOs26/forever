import { describe, expect, it } from "vitest";

import {
  INVESTMENT_SCORE_UNAVAILABLE,
  NOT_AVAILABLE,
  deriveInvestmentIntelligence,
} from "../investment-intelligence";
import { makeInvestmentRow, makeProject, makeUnit } from "./fixtures";

describe("deriveInvestmentIntelligence — sparse (Modeva-like) record", () => {
  const result = deriveInvestmentIntelligence(makeProject());

  it("renders missing investment data as 'Not available'", () => {
    expect(result.entryPrice).toBe(NOT_AVAILABLE);
    expect(result.availableUnitRange).toBe(NOT_AVAILABLE);
    expect(result.priceVerificationStatus).toBe(NOT_AVAILABLE);
    expect(result.rentalEvidence).toBe(NOT_AVAILABLE);
    expect(result.investmentEvidence).toBe(NOT_AVAILABLE);
  });

  it("still surfaces the verified context that does exist", () => {
    expect(result.constructionContext).toBe("Planning");
    expect(result.developerContext).toBe("Title");
    expect(result.liquidityEvidence).toBe("Sales status: Available");
  });

  it("lists the key data gaps deterministically", () => {
    expect(result.keyDataGaps).toEqual([
      "Entry price",
      "Verified price confirmation",
      "Unit inventory",
      "Rental / income evidence",
      "Structured investment data",
    ]);
  });

  it("never produces a numeric investment score", () => {
    expect(result.investmentScore).toBe(INVESTMENT_SCORE_UNAVAILABLE);
    expect(result.investmentScore).toBe("Investment score not available");
  });

  it("returns the conservative verdict when foundational evidence is missing", () => {
    expect(result.readinessVerdict).toBe("Insufficient verified data");
    expect(result.verdictRationale).toContain("entry price");
  });
});

describe("deriveInvestmentIntelligence — no fabrication", () => {
  it("never surfaces yield, ROI, occupancy, growth, or a market average", () => {
    const result = deriveInvestmentIntelligence(
      makeProject({
        investment: {
          investmentValue: 99,
          rentalYield: "8% projected",
          capitalGrowthEstimate: "12% growth",
          rows: [makeInvestmentRow({ annualRoiPercent: 7, occupancyRate: 85 })],
        },
      }),
    );

    const textFields = [
      result.entryPrice,
      result.availableUnitRange,
      result.priceVerificationStatus,
      result.rentalEvidence,
      result.investmentEvidence,
      result.constructionContext,
      result.developerContext,
      result.liquidityEvidence,
    ];

    for (const field of textFields) {
      expect(field).not.toMatch(/%/);
      expect(field.toLowerCase()).not.toContain("yield");
      expect(field.toLowerCase()).not.toContain("roi");
      expect(field.toLowerCase()).not.toContain("occupancy");
      expect(field.toLowerCase()).not.toContain("growth");
      expect(field.toLowerCase()).not.toContain("market average");
    }

    // The opaque internal `investmentValue` (99) is never surfaced as evidence.
    expect(JSON.stringify(textFields)).not.toContain("99");
  });

  it("never reuses trustScore as investmentScore or matchScore", () => {
    const trustScore = 87;
    const result = deriveInvestmentIntelligence(makeProject({ trust: { trustScore } }));

    expect(result.investmentScore).toBe(INVESTMENT_SCORE_UNAVAILABLE);
    // The derived output must not carry the trust score value anywhere.
    expect(JSON.stringify(result)).not.toContain(String(trustScore));
    expect(result).not.toHaveProperty("matchScore");
  });
});

describe("deriveInvestmentIntelligence — determinism", () => {
  it("produces identical output for identical input", () => {
    const project = makeProject({
      pricing: { startingPriceTHB: 5_000_000, verifiedPrice: "THB 5,000,000 (verified)" },
      units: [makeUnit({ bedrooms: 1, sizeSqm: 35, basePriceTHB: 5_000_000 })],
      investment: { rows: [makeInvestmentRow({ expectedMonthlyRent: 40_000 })] },
    });

    const first = deriveInvestmentIntelligence(project);
    const second = deriveInvestmentIntelligence(project);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
  });
});

describe("deriveInvestmentIntelligence — verdict tiers", () => {
  it("is 'Ready for preliminary review' with all foundational + ≥2 depth signals", () => {
    const result = deriveInvestmentIntelligence(
      makeProject({
        pricing: { startingPriceTHB: 5_000_000, verifiedPrice: "THB 5,000,000 (verified)" },
        units: [
          makeUnit({
            bedrooms: 1,
            sizeSqm: 35,
            basePriceTHB: 5_000_000,
            availabilityStatus: "available",
          }),
          makeUnit({ id: "unit-2", code: "A-102", availabilityStatus: "sold" }),
        ],
        investment: { rows: [makeInvestmentRow({ expectedMonthlyRent: 40_000 })] },
      }),
    );

    expect(result.readinessVerdict).toBe("Ready for preliminary review");
    expect(result.entryPrice).toBe("From THB 5,000,000");
    expect(result.priceVerificationStatus).toContain("Verified");
    expect(result.rentalEvidence).toContain("rent figures");
    expect(result.liquidityEvidence).toBe("2 units on record; 1 available, 1 sold");
    expect(result.keyDataGaps).toEqual([]);
  });

  it("is 'More evidence required' with foundational present but <2 depth signals", () => {
    const result = deriveInvestmentIntelligence(
      makeProject({
        pricing: { startingPriceTHB: 5_000_000 },
        units: [makeUnit({ basePriceTHB: 5_000_000 })],
      }),
    );

    // Depth: unit inventory only (no verified price, no income evidence).
    expect(result.signals.hasEntryPrice).toBe(true);
    expect(result.signals.hasUnitInventory).toBe(true);
    expect(result.signals.hasVerifiedPrice).toBe(false);
    expect(result.signals.hasIncomeEvidence).toBe(false);
    expect(result.readinessVerdict).toBe("More evidence required");
  });

  it("derives entry price from unit prices when no starting price is set", () => {
    const result = deriveInvestmentIntelligence(
      makeProject({
        units: [
          makeUnit({ basePriceTHB: 8_000_000 }),
          makeUnit({
            id: "u2",
            code: "B-2",
            basePriceTHB: 6_500_000,
            discountedPriceTHB: 6_000_000,
          }),
        ],
      }),
    );

    expect(result.entryPrice).toBe("From THB 6,000,000");
    expect(result.priceVerificationStatus).toBe("Listed price, not independently verified");
  });
});
