import type { IntelligenceInput, ScoreResult } from "../intelligence-types";

function band(score: number): ScoreResult["band"] {
  if (score >= 85) return "excellent";
  if (score >= 70) return "strong";
  if (score >= 50) return "fair";
  if (score > 0) return "weak";
  return "unknown";
}

export function scoreLiquidity(input: IntelligenceInput): ScoreResult {
  const fields = input.fields;
  let score = 0;

  if (fields.salesStatus === "Available" || fields.salesStatus === "Selling") score += 20;
  if (fields.salesStatus === "Sold Out") score += 10;
  if (fields.rentalDemand === "Very High") score += 25;
  if (fields.rentalDemand === "High") score += 20;
  if (fields.rentalDemand === "Moderate") score += 10;
  if (fields.availableUnitCount > 0) score += 15;
  if (fields.unitCount > 0) score += 10;
  if (fields.projectType) score += 10;
  if (fields.locationArea) score += 10;
  if (fields.marketPosition === "Below market") score += 10;

  const finalScore = Math.min(100, Math.round(score));

  return {
    key: "liquidity",
    label: "Liquidity",
    score: finalScore,
    maxScore: 100,
    band: band(finalScore),
    summary: "Liquidity score uses sales status, unit availability, demand, project type, location, and market position.",
    sourceFields: [
      "core.status",
      "units.availabilityStatus",
      "investment.rentalDemand",
      "core.type",
      "core.location",
      "trust.marketPosition",
    ],
    sourceValues: {
      salesStatus: fields.salesStatus,
      unitCount: fields.unitCount,
      availableUnitCount: fields.availableUnitCount,
      rentalDemand: fields.rentalDemand,
      projectType: fields.projectType,
      locationArea: fields.locationArea,
      marketPosition: fields.marketPosition,
    },
  };
}
