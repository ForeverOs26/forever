import type { IntelligenceInput, ScoreResult } from "../intelligence-types";

function band(score: number): ScoreResult["band"] {
  if (score >= 85) return "excellent";
  if (score >= 70) return "strong";
  if (score >= 50) return "fair";
  if (score > 0) return "weak";
  return "unknown";
}

export function scoreTrust(input: IntelligenceInput): ScoreResult {
  const fields = input.fields;
  let score = 0;

  score += Math.min(fields.trustScore, 10) * 6;
  if (fields.foreverVerified) score += 20;
  if (fields.lastInspection) score += 10;
  if (fields.developerName) score += 5;
  if (fields.verifiedPrice) score += 5;

  const finalScore = Math.min(100, Math.round(score));

  return {
    key: "trust",
    label: "Trust",
    score: finalScore,
    maxScore: 100,
    band: band(finalScore),
    summary: fields.foreverVerified
      ? "Project has Forever verification and supporting trust data."
      : "Project trust score is based on available verification fields.",
    sourceFields: [
      "trust.trustScore",
      "trust.foreverVerified",
      "trust.lastInspection",
      "developer.name",
      "pricing.verifiedPrice",
    ],
    sourceValues: {
      trustScore: fields.trustScore,
      foreverVerified: fields.foreverVerified,
      lastInspection: fields.lastInspection,
      developerName: fields.developerName,
      verifiedPrice: fields.verifiedPrice,
    },
  };
}
