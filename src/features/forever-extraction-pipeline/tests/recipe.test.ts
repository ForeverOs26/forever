import { describe, expect, it } from "vitest";

import {
  EXTRACTION_STAGE_KINDS,
  EXTRACTION_STEP_KINDS,
  extractionRecipe,
  extractionRecipeStepCount,
  foreverExtractionRecipe,
  listExtractionRecipeSteps,
  validateExtractionRecipe,
} from "..";

describe("canonical extraction recipe", () => {
  it("orders its stages prepare → extract → assess → verify with ordered steps", () => {
    const recipe = foreverExtractionRecipe();
    expect(recipe.stages.map((stage) => stage.kind)).toEqual([...EXTRACTION_STAGE_KINDS]);
    expect(recipe.stages.map((stage) => stage.id)).toEqual([
      "prepare",
      "extract",
      "assess",
      "verify",
    ]);
    expect(listExtractionRecipeSteps(recipe).map((step) => step.id)).toEqual([
      "resolve-source",
      "pin-version",
      "select-method",
      "locate-evidence",
      "describe-facts",
      "attach-provenance",
      "grade-confidence",
      "validate-facts",
      "record-attempt",
    ]);
    expect(extractionRecipeStepCount(recipe)).toBe(9);
  });

  it("uses only known step kinds and keeps the record step optional by contract", () => {
    const steps = listExtractionRecipeSteps(foreverExtractionRecipe());
    for (const step of steps) {
      expect(EXTRACTION_STEP_KINDS).toContain(step.kind);
    }
    const record = steps.find((step) => step.kind === "record");
    expect(record?.optional).toBe(true);
    expect(steps.filter((step) => step.optional).map((step) => step.id)).toEqual([
      "record-attempt",
    ]);
  });

  it("restricts neither document type nor file format and designates no method", () => {
    const recipe = foreverExtractionRecipe();
    expect(recipe.documentTypes).toBeUndefined();
    expect(recipe.fileFormats).toBeUndefined();
    expect(recipe.method).toBeUndefined();
  });

  it("validates cleanly and stays pure across calls", () => {
    expect(validateExtractionRecipe(foreverExtractionRecipe())).toEqual([]);
    expect(foreverExtractionRecipe()).toEqual(foreverExtractionRecipe());
    expect(foreverExtractionRecipe()).not.toBe(foreverExtractionRecipe());
  });

  it("extractionRecipe attaches optional facts only when supplied", () => {
    const recipe = foreverExtractionRecipe();
    const bare = extractionRecipe("bare", "Bare", recipe.stages, ["price"]);
    expect(bare).toEqual({ id: "bare", name: "Bare", stages: recipe.stages, factTypes: ["price"] });
    expect(Object.keys(bare)).not.toContain("documentTypes");
    expect(Object.keys(bare)).not.toContain("method");

    const narrowed = extractionRecipe("narrow", "Narrow", recipe.stages, ["price"], {
      documentTypes: ["price_list"],
      fileFormats: ["pdf"],
      method: { kind: "pdf_text" },
      description: "Reads price lists only.",
    });
    expect(narrowed.documentTypes).toEqual(["price_list"]);
    expect(narrowed.fileFormats).toEqual(["pdf"]);
    expect(narrowed.method).toEqual({ kind: "pdf_text" });
  });
});
