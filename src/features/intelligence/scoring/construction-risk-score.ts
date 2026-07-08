import type { IntelligenceInput, ScoreResult } from "../intelligence-types";

function band(score: number): ScoreResult["band"] {
  if (score >= 85) return "excellent";
  if (score >= 70) return "strong";
  if (score >= 50) return "fair";
  if (score > 0) return "weak";
  return "unknown";
}

function statusScore(status: string): number {
  if (status === "Ready") return 45;
  if (status === "Nearing Completion") return 35;
  if (status === "Under Construction") return 25;
  if (status === "Pre-Launch") return 12;
  if (status === "Planning") return 6;
  if (status === "Sold Out") return 35;
  return 0;
}

export function scoreConstructionRisk(input: IntelligenceInput): ScoreResult {
  const fields = input.fields;
  let score = statusScore(fields.constructionStatus);

  if (fields.lastInspection) score += 25;
  if (fields.foreverVerified) score += 20;
  if (fields.developerName) score += 10;

  const finalScore = Math.min(100, Math.round(score));

  return {
    key: "constructionRisk",
    label: "Construction Risk",
    score: finalScore,
    maxScore: 100,
    band: band(finalScore),
    summary: "Construction risk score rewards readiness, inspection evidence, verification, and developer attribution.",
    sourceFields: [
      "core.constructionStatus",
      "trust.lastInspection",
      "trust.foreverVerified",
      "developer.name",
    ],
    sourceValues: {
      constructionStatus: fields.constructionStatus,
      lastInspection: fields.lastInspection,
      foreverVerified: fields.foreverVerified,
      developerName: fields.developerName,
    },
  };
}
