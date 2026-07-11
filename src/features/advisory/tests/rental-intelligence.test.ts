import { describe, expect, it } from "vitest";

import { NOT_AVAILABLE } from "../investment-intelligence";
import { RENTAL_SCORE_UNAVAILABLE, deriveRentalIntelligence } from "../rental-intelligence";
import { makeInvestmentRow, makeProject, makeUnit } from "./fixtures";

describe("deriveRentalIntelligence — sparse (Modeva-like) record", () => {
  const result = deriveRentalIntelligence(makeProject());

  it("renders missing rental data as 'Not available'", () => {
    expect(result.demandContext).toBe(NOT_AVAILABLE);
    expect(result.incomeEvidence).toBe(NOT_AVAILABLE);
    expect(result.occupancyEvidence).toBe(NOT_AVAILABLE);
    expect(result.returnEvidence).toBe(NOT_AVAILABLE);
    expect(result.guaranteeEvidence).toBe(NOT_AVAILABLE);
    expect(result.managementContext).toBe(NOT_AVAILABLE);
  });

  it("always reports seasonality and competition as 'Not available' (no verified source)", () => {
    expect(result.seasonalityEvidence).toBe(NOT_AVAILABLE);
    expect(result.competitionEvidence).toBe(NOT_AVAILABLE);
  });

  it("lists the key data gaps deterministically", () => {
    expect(result.keyDataGaps).toEqual([
      "Rental demand",
      "Rental income evidence",
      "Management company",
      "Occupancy data",
      "ROI data",
      "Rental guarantee",
    ]);
  });

  it("never produces a numeric rental score", () => {
    expect(result.rentalScore).toBe(RENTAL_SCORE_UNAVAILABLE);
    expect(result.rentalScore).toBe("Rental score not available");
  });

  it("returns the conservative verdict when foundational evidence is missing", () => {
    expect(result.readinessVerdict).toBe("Insufficient verified data");
    expect(result.verdictRationale).toContain("rent evidence");
  });
});

describe("deriveRentalIntelligence — no fabrication", () => {
  it("never surfaces raw occupancy, ADR, ROI, revenue, yield, or growth figures", () => {
    const result = deriveRentalIntelligence(
      makeProject({
        investment: {
          rentalDemand: "High",
          rentalYield: "8% projected",
          capitalGrowthEstimate: "12% growth",
          rows: [
            makeInvestmentRow({
              expectedMonthlyRent: 123456,
              occupancyRate: 85,
              annualRoiPercent: 77,
              guaranteedRentalPercent: 9,
              managementCompany: "Acme",
            }),
          ],
        },
        units: [makeUnit({ rentalGuarantee: "7% NET" })],
      }),
    );

    // Fields that describe evidence for sensitive numeric metrics must never
    // leak the raw figures or a percentage sign.
    const numericRiskFields = [
      result.incomeEvidence,
      result.occupancyEvidence,
      result.returnEvidence,
      result.guaranteeEvidence,
      result.seasonalityEvidence,
      result.competitionEvidence,
    ];
    for (const field of numericRiskFields) {
      expect(field).not.toMatch(/%/);
      expect(field.toLowerCase()).not.toContain("growth");
    }

    // No raw sensitive value appears anywhere in the derived output.
    const serialized = JSON.stringify(result);
    for (const raw of ["8% projected", "12% growth", "123456", "85", "77", "7% NET"]) {
      expect(serialized).not.toContain(raw);
    }
  });

  it("never reuses trustScore as a rental score or match score", () => {
    const trustScore = 87;
    const result = deriveRentalIntelligence(makeProject({ trust: { trustScore } }));

    expect(result.rentalScore).toBe(RENTAL_SCORE_UNAVAILABLE);
    expect(JSON.stringify(result)).not.toContain(String(trustScore));
    expect(result).not.toHaveProperty("matchScore");
  });
});

describe("deriveRentalIntelligence — determinism", () => {
  it("produces identical output for identical input", () => {
    const project = makeProject({
      investment: {
        rentalDemand: "High",
        rows: [makeInvestmentRow({ expectedMonthlyRent: 40_000, managementCompany: "Acme" })],
      },
    });

    const first = deriveRentalIntelligence(project);
    const second = deriveRentalIntelligence(project);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
  });
});

describe("deriveRentalIntelligence — verdict tiers", () => {
  it("is 'Ready for preliminary review' with all foundational + ≥2 depth signals", () => {
    const result = deriveRentalIntelligence(
      makeProject({
        investment: {
          rentalDemand: "High",
          rows: [
            makeInvestmentRow({
              expectedMonthlyRent: 40_000,
              occupancyRate: 80,
              annualRoiPercent: 6,
              managementCompany: "Acme Rentals",
            }),
          ],
        },
      }),
    );

    expect(result.signals).toEqual({
      hasDemandSignal: true,
      hasIncomeEvidence: true,
      hasOccupancyEvidence: true,
      hasReturnEvidence: true,
      hasGuarantee: false,
      hasManagement: true,
    });
    expect(result.readinessVerdict).toBe("Ready for preliminary review");
    expect(result.demandContext).toBe("Recorded rental demand: High");
    expect(result.incomeEvidence).toBe("1 investment record(s) with rent figures");
    expect(result.managementContext).toBe("Managed by Acme Rentals");
    expect(result.keyDataGaps).toEqual(["Rental guarantee"]);
  });

  it("is 'More evidence required' with foundational present but <2 depth signals", () => {
    const result = deriveRentalIntelligence(
      makeProject({
        investment: {
          rentalDemand: "Moderate",
          rows: [makeInvestmentRow({ expectedMonthlyRent: 40_000, managementCompany: "Acme" })],
        },
      }),
    );

    expect(result.signals.hasIncomeEvidence).toBe(true);
    expect(result.signals.hasDemandSignal).toBe(true);
    expect(result.signals.hasManagement).toBe(true);
    expect(result.signals.hasOccupancyEvidence).toBe(false);
    expect(result.signals.hasReturnEvidence).toBe(false);
    expect(result.readinessVerdict).toBe("More evidence required");
  });

  it("deduplicates management companies across investment records", () => {
    const result = deriveRentalIntelligence(
      makeProject({
        investment: {
          rentalDemand: "High",
          rows: [
            makeInvestmentRow({ id: "a", managementCompany: "Acme", expectedMonthlyRent: 40_000 }),
            makeInvestmentRow({ id: "b", managementCompany: "Acme", expectedYearlyRent: 480_000 }),
            makeInvestmentRow({ id: "c", managementCompany: "Beta", expectedMonthlyRent: 30_000 }),
          ],
        },
      }),
    );

    expect(result.managementContext).toBe("Managed by Acme, Beta");
    expect(result.incomeEvidence).toBe("3 investment record(s) with rent figures");
  });
});
