import type { IntelligenceInput, ScoreResult } from "../intelligence-types";

function band(score: number): ScoreResult["band"] {
  if (score >= 85) return "excellent";
  if (score >= 70) return "strong";
  if (score >= 50) return "fair";
  if (score > 0) return "weak";
  return "unknown";
}

function demandScore(demand: string): number {
  if (demand === "Very High") return 25;
  if (demand === "High") return 20;
  if (demand === "Moderate") return 12;
  if (demand === "Low") return 4;
  return 0;
}

export function scoreRental(input: IntelligenceInput): ScoreResult {
  const fields = input.fields;
  let score = 0;

  score += demandScore(fields.rentalDemand);
  if (fields.rentalYieldPercent !== null) score += Math.min(fields.rentalYieldPercent * 6, 30);
  if (fields.averageOccupancyRate !== null) score += Math.min(fields.averageOccupancyRate / 3, 20);
  if (fields.averageAnnualRoiPercent !== null) score += Math.min(fields.averageAnnualRoiPercent * 3, 15);
  if (fields.hasRentalGuarantee) score += 10;

  const finalScore = Math.min(100, Math.round(score));

  return {
    key: "rental",
    label: "Rental",
    score: finalScore,
    maxScore: 100,
    band: band(finalScore),
    summary: "Rental score uses demand, yield, occupancy, ROI, and rental guarantee evidence.",
    sourceFields: [
      "investment.rentalDemand",
      "investment.rentalYield",
      "investment.rows.occupancyRate",
      "investment.rows.annualRoiPercent",
      "units.rentalGuarantee",
    ],
    sourceValues: {
      rentalDemand: fields.rentalDemand,
      rentalYieldText: fields.rentalYieldText,
      rentalYieldPercent: fields.rentalYieldPercent,
      averageOccupancyRate: fields.averageOccupancyRate,
      averageAnnualRoiPercent: fields.averageAnnualRoiPercent,
      hasRentalGuarantee: fields.hasRentalGuarantee,
    },
  };
}
