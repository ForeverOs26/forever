import { describe, expect, it } from "vitest";

import {
  FOREVER_EXTRACTION_PIPELINE_ID,
  FOREVER_EXTRACTION_RECIPE_ID,
  SUPPORTED_EXTRACTION_FACT_TYPES,
  buildForeverExtractionPipeline,
  defineExtraction,
  extractionIdForSlug,
  foreverExtractionIdentity,
  validateExtractionDefinition,
} from "..";

describe("canonical extraction definition", () => {
  it("derives its constant id through the module's own naming rule", () => {
    expect(FOREVER_EXTRACTION_PIPELINE_ID).toBe(extractionIdForSlug("forever-extraction"));
    expect(buildForeverExtractionPipeline().identity).toEqual(foreverExtractionIdentity());
    expect(buildForeverExtractionPipeline().identity.id).toBe(FOREVER_EXTRACTION_PIPELINE_ID);
  });

  it("declares one canonical recipe covering the full supported fact vocabulary", () => {
    const definition = buildForeverExtractionPipeline();
    expect(definition.recipes).toHaveLength(1);
    expect(definition.recipes[0].id).toBe(FOREVER_EXTRACTION_RECIPE_ID);
    expect(definition.factTypes).toEqual([...SUPPORTED_EXTRACTION_FACT_TYPES]);
    expect(definition.factTypes).not.toContain("unknown");
  });

  it("carries the reused RC4.0 safe default policy: dry-run only, abort, no retry", () => {
    const policy = buildForeverExtractionPipeline().policy;
    expect(policy).toMatchObject({
      executionMode: "sequential",
      onError: "abort",
      retry: { maxAttempts: 1, backoff: "none" },
      dryRunOnly: true,
    });
  });

  it("validates cleanly with no issues at all", () => {
    expect(validateExtractionDefinition(buildForeverExtractionPipeline())).toEqual([]);
  });

  it("defineExtraction pins the shape without changing the definition", () => {
    const definition = buildForeverExtractionPipeline();
    expect(defineExtraction(definition)).toBe(definition);
  });
});
