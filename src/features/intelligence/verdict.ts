import type { ForeverVerdict, ScoreResult } from "./intelligence-types";

export type WeightedScores = {
  trust: ScoreResult;
  investment: ScoreResult;
  rental: ScoreResult;
  location: ScoreResult;
  liquidity: ScoreResult;
  constructionRisk: ScoreResult;
};

const WEIGHTS: Record<keyof WeightedScores, number> = {
  trust: 0.25,
  investment: 0.25,
  rental: 0.2,
  location: 0.15,
  liquidity: 0.1,
  constructionRisk: 0.05,
};

export function calculateTotalScore(scores: WeightedScores): number {
  return Math.round(
    (Object.keys(WEIGHTS) as Array<keyof WeightedScores>).reduce(
      (total, key) => total + scores[key].score * WEIGHTS[key],
      0,
    ),
  );
}

export function getForeverVerdict(totalScore: number): ForeverVerdict {
  if (totalScore >= 85) return "Strong Buy";
  if (totalScore >= 75) return "Excellent Long-Term Investment";
  if (totalScore >= 65) return "Ideal Family Residence";
  if (totalScore >= 55) return "Lifestyle Purchase";
  return "Wait for Better Pricing";
}
