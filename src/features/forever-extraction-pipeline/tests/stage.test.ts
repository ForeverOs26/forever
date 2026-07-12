import { describe, expect, it } from "vitest";

import {
  EXTRACTION_STAGE_KINDS,
  extractionStage,
  extractionStep,
  isKnownExtractionStageKind,
  validateExtractionStage,
} from "..";

describe("extraction stages", () => {
  const step = extractionStep("describe-facts", "Describe the facts", "extract");

  it("builds a stage and attaches continueOnError only when supplied", () => {
    const bare = extractionStage("extract", "Extract", "extract", [step]);
    expect(bare).toEqual({ id: "extract", name: "Extract", kind: "extract", steps: [step] });
    expect(Object.keys(bare)).not.toContain("continueOnError");

    const tolerant = extractionStage("extract", "Extract", "extract", [step], {
      continueOnError: true,
    });
    expect(tolerant.continueOnError).toBe(true);
  });

  it("guards the closed stage-kind vocabulary", () => {
    for (const kind of EXTRACTION_STAGE_KINDS) {
      expect(isKnownExtractionStageKind(kind)).toBe(true);
    }
    expect(isKnownExtractionStageKind("generate")).toBe(false);
    expect(isKnownExtractionStageKind(7)).toBe(false);
    expect(isKnownExtractionStageKind(null)).toBe(false);
  });

  it("flags missing ids, unknown kinds, empty stages, and duplicate step ids", () => {
    const issues = validateExtractionStage(
      { id: "", name: "", kind: "generate" as never, steps: [] },
      "stages.0",
    );
    expect(issues.map((issue) => issue.code)).toEqual([
      "missing_stage_id",
      "missing_stage_name",
      "unknown_stage_kind",
      "empty_stage",
    ]);

    const duplicated = validateExtractionStage(
      extractionStage("extract", "Extract", "extract", [step, { ...step }]),
      "stages.0",
    );
    expect(duplicated.map((issue) => issue.code)).toEqual(["duplicate_step_id"]);
    expect(duplicated[0].path).toBe("stages.0.steps.1.id");
  });
});
