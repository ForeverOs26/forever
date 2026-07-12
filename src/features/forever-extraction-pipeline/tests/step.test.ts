import { describe, expect, it } from "vitest";

import {
  EXTRACTION_STEP_KINDS,
  extractionStep,
  isKnownExtractionStepKind,
  validateExtractionStep,
} from "..";

describe("extraction steps", () => {
  it("builds a step and attaches optional references only when supplied", () => {
    const bare = extractionStep("describe-facts", "Describe the facts", "extract");
    expect(bare).toEqual({ id: "describe-facts", name: "Describe the facts", kind: "extract" });
    expect(Object.keys(bare)).not.toContain("factTypes");
    expect(Object.keys(bare)).not.toContain("optional");

    const narrowed = extractionStep("describe-prices", "Describe the prices", "extract", {
      factTypes: ["price", "currency"],
      optional: true,
      description: "Prices only.",
    });
    expect(narrowed.factTypes).toEqual(["price", "currency"]);
    expect(narrowed.optional).toBe(true);
  });

  it("guards the closed step-kind vocabulary", () => {
    for (const kind of EXTRACTION_STEP_KINDS) {
      expect(isKnownExtractionStepKind(kind)).toBe(true);
    }
    expect(isKnownExtractionStepKind("parse")).toBe(false);
    expect(isKnownExtractionStepKind(undefined)).toBe(false);
  });

  it("flags missing fields, unknown kinds, and bad fact-type references", () => {
    const issues = validateExtractionStep(
      {
        id: "",
        name: "",
        kind: "parse" as never,
        factTypes: ["price", "price", "vibes" as never],
      },
      "stages.0.steps.0",
    );
    expect(issues.map((issue) => issue.code)).toEqual([
      "missing_step_id",
      "missing_step_name",
      "unknown_step_kind",
      "duplicate_step_fact_type",
      "unsupported_fact_type",
    ]);
    expect(issues[4].path).toBe("stages.0.steps.0.factTypes.2");
  });
});
