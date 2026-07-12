import { describe, expect, it } from "vitest";

import {
  EXTRACTION_CONFIDENCE_LEVELS,
  compareExtractionConfidence,
  extractionConfidence,
  extractionConfidenceRank,
  isKnownExtractionConfidenceLevel,
  meetsExtractionConfidence,
  unknownExtractionConfidence,
  validateExtractionConfidence,
} from "..";

describe("extraction confidence", () => {
  it("keeps unknown a first-class rung with no score", () => {
    expect(unknownExtractionConfidence()).toEqual({ level: "unknown" });
    expect(EXTRACTION_CONFIDENCE_LEVELS[0]).toBe("unknown");
    expect(meetsExtractionConfidence("unknown", "unknown")).toBe(true);
    expect(meetsExtractionConfidence("unknown", "low")).toBe(false);
  });

  it("ranks and compares the ladder deterministically", () => {
    const ranks = EXTRACTION_CONFIDENCE_LEVELS.map(extractionConfidenceRank);
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
    expect([...EXTRACTION_CONFIDENCE_LEVELS].sort(compareExtractionConfidence)).toEqual([
      "certain",
      "high",
      "medium",
      "low",
      "unknown",
    ]);
    expect(meetsExtractionConfidence("high", "medium")).toBe(true);
    expect(meetsExtractionConfidence("low", "medium")).toBe(false);
  });

  it("builds a confidence and attaches the score only when supplied", () => {
    expect(extractionConfidence("high")).toEqual({ level: "high" });
    expect(extractionConfidence("high", { score: 0.9 })).toEqual({ level: "high", score: 0.9 });
  });

  it("guards the vocabulary", () => {
    for (const level of EXTRACTION_CONFIDENCE_LEVELS) {
      expect(isKnownExtractionConfidenceLevel(level)).toBe(true);
    }
    expect(isKnownExtractionConfidenceLevel("absolute")).toBe(false);
    expect(isKnownExtractionConfidenceLevel(0.9)).toBe(false);
  });

  it("validation flags unknown levels, out-of-range scores, and scores on unknown", () => {
    expect(validateExtractionConfidence({ level: "high", score: 0.5 })).toEqual([]);
    expect(validateExtractionConfidence({ level: "high", score: 0 })).toEqual([]);
    expect(validateExtractionConfidence({ level: "high", score: 1 })).toEqual([]);

    expect(
      validateExtractionConfidence({ level: "absolute" as never }).map((issue) => issue.code),
    ).toEqual(["unknown_confidence_level"]);
    expect(
      validateExtractionConfidence({ level: "high", score: 1.2 }).map((issue) => issue.code),
    ).toEqual(["invalid_confidence_score"]);
    expect(
      validateExtractionConfidence({ level: "high", score: Number.NaN }).map((issue) => issue.code),
    ).toEqual(["invalid_confidence_score"]);
    expect(
      validateExtractionConfidence({ level: "unknown", score: 0.5 }).map((issue) => issue.code),
    ).toEqual(["score_on_unknown_confidence"]);
  });
});
