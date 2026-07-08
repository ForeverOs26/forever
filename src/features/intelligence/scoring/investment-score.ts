import type { IntelligenceInput, ScoreResult } from "../intelligence-types";

function band(score: number): ScoreResult["band"] {
  if (score >= 85) return "excellent";
  if (score >= 70) return "strong";
  if (score >= 50) return "fair";
  if (score > 0) return "weak";
  return "unknown";
}

export function scoreInvestment(input: IntelligenceInput): ScoreResult {
  const fields = input.fields;
  let score = 0;

  score += Math.min(fields.investmentValue, 10) * 6;
  if (fields.marketPosition === "Below market") score += 15;
  if (fields.marketPosition === "In line with market") score += 10;
  if (fields.capitalGrowthPercent !== null) score += Math.min(fields.capitalGrowthPercent * 2, 15);
  if (fields.startingPriceTHB > 0) score += 5;
  if (fields.pricePerSqm) score += 5;

  const finalScore = Math.min(100, Math.round(score));

  return {
    key: "investment",
    label: "Investment",
    score: finalScore,
    maxScore: 100,
    band: band(finalScore),
    summary: "Investment score combines value rating, market position, growth estimate, and price evidence.",
    sourceFields: [
      "investment.investmentValue",
      "trust.marketPosition",
      "investment.capitalGrowthEstimate",
      "pricing.startingPriceTHB",
      "pricing.pricePerSqm",
    ],
    sourceValues: {
      investmentValue: fields.investmentValue,
      marketPosition: fields.marketPosition,
      capitalGrowthEstimate: fields.capitalGrowthEstimate,
      capitalGrowthPercent: fields.capitalGrowthPercent,
      startingPriceTHB: fields.startingPriceTHB,
      pricePerSqm: fields.pricePerSqm,
    },
  };
}
