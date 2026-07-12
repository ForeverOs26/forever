import { describe, expect, it } from "vitest";

import {
  SUPPORTED_EXTRACTION_FACT_TYPES,
  extractionPlanHistoryEntry,
  extractionVersion,
  planExtraction,
} from "..";
import { makeContext, makeRequest, makeSource } from "./fixtures";

describe("planExtraction", () => {
  it("describes a clean plan over a catalogued source, targets only — never values", () => {
    const result = planExtraction(makeContext(), makeRequest());
    expect(result.ok).toBe(true);
    expect(result.state).toBe("succeeded");
    expect(result.outcome).toBe("success");
    expect(result.data).toHaveLength(1);

    const plan = result.data[0];
    expect(plan).toMatchObject({
      id: "xplan_proj-coralina-price-list-v1-0-0",
      definitionId: "extr_forever-extraction",
      recipeId: "forever-extraction",
      projectId: "proj_coralina",
      sourceId: "psrc_coralina-price-list-v1-0-0",
      sourceVersion: { major: 1, minor: 0, patch: 0 },
      documentKey: "proj_coralina:price-list",
    });
    expect(plan.targets).toEqual([...SUPPORTED_EXTRACTION_FACT_TYPES]);
    // Anti-fabrication: a plan names what would be attempted, never a value.
    expect(JSON.stringify(plan)).not.toContain("rawValue");
    expect(JSON.stringify(plan)).not.toContain("structuredValue");
    expect(Object.keys(plan)).not.toContain("method");
  });

  it("orders targets canonically regardless of request order, deduplicated", () => {
    const result = planExtraction(
      makeContext(),
      makeRequest({ factTypes: ["currency", "price", "bedrooms", "price"] }),
    );
    expect(result.data[0].targets).toEqual(["bedrooms", "price", "currency"]);
    expect(result.metadata.targetCount).toBe(3);
  });

  it("is source-version-aware: a newer revision plans under its own id", () => {
    const v2 = makeSource({ version: extractionVersion(2, 0, 0) });
    const result = planExtraction(makeContext(), makeRequest({ source: v2 }));
    expect(result.data[0].id).toBe("xplan_proj-coralina-price-list-v2-0-0");
    expect(result.data[0].sourceVersion).toEqual({ major: 2, minor: 0, patch: 0 });
    expect(result.metadata.sourceVersion).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it("reports an unknown recipe as a blocked result, never a throw", () => {
    const result = planExtraction(makeContext(), makeRequest({ recipeId: "nope" }));
    expect(result.ok).toBe(false);
    expect(result.data).toEqual([]);
    expect(result.errors.map((error) => error.code)).toEqual(["unknown_recipe"]);
    expect(result.state).toBe("failed");
    expect(result.outcome).toBe("failure");
  });

  it("reports an absent source as a blocked result, never a throw", () => {
    const result = planExtraction(makeContext(), { source: null as never });
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(["missing_plan_source"]);
  });

  it("flags unsupported and undeclared fact types deterministically", () => {
    const result = planExtraction(
      makeContext(),
      makeRequest({ factTypes: ["price", "vibes" as never, "unknown"] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(["unsupported_fact_type"]);
    // "unknown" is a known vocabulary value the canonical recipe does not declare.
    expect(result.warnings.map((warning) => warning.code)).toEqual(["undeclared_fact_type"]);
    expect(result.data[0].targets).toEqual(["price"]);
  });

  it("blocks a plan whose every target is unresolvable", () => {
    const result = planExtraction(makeContext(), makeRequest({ factTypes: ["unknown"] }));
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("no_extraction_targets");
    expect(result.data[0].targets).toEqual([]);
  });

  it("surfaces reused RC4.4 source validation through the plan and fails only verify steps", () => {
    const incoherent = makeSource();
    incoherent.status = "published" as never;
    const result = planExtraction(makeContext(), makeRequest({ source: incoherent }));
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("unknown_source_status");
    // 9 steps, 2 of them in the verify stage: a blocked plan fails exactly those.
    expect(result.stats).toMatchObject({ steps: 9, completed: 7, failed: 2 });
    expect(result.state).toBe("partial");
  });

  it("warns when the recipe does not read the source's document type or file format", () => {
    const definition = makeContext().definition;
    definition.recipes[0].documentTypes = ["brochure"];
    definition.recipes[0].fileFormats = ["excel"];
    const result = planExtraction({ definition }, makeRequest());
    expect(result.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "recipe_document_type_mismatch",
      "recipe_file_format_mismatch",
    ]);
  });

  it("stamps plannedAt only from the caller-supplied context clock", () => {
    expect(planExtraction(makeContext(), makeRequest()).metadata.plannedAt).toBeUndefined();
    expect(
      planExtraction(makeContext({ now: "2026-07-12T00:00:00.000Z" }), makeRequest()).metadata
        .plannedAt,
    ).toBe("2026-07-12T00:00:00.000Z");
  });

  it("derives a history entry that copies the settled result and attaches only known facts", () => {
    const result = planExtraction(makeContext(), makeRequest());
    const entry = extractionPlanHistoryEntry(result, {
      startedAt: "2026-07-12T00:00:00.000Z",
      finishedAt: "2026-07-12T00:00:01.000Z",
    });
    expect(entry).toMatchObject({
      definitionId: "extr_forever-extraction",
      planId: "xplan_proj-coralina-price-list-v1-0-0",
      recipeId: "forever-extraction",
      sourceId: "psrc_coralina-price-list-v1-0-0",
      sourceVersion: { major: 1, minor: 0, patch: 0 },
      state: result.state,
      outcome: result.outcome,
      stats: result.stats,
    });

    const blocked = extractionPlanHistoryEntry(
      planExtraction(makeContext(), makeRequest({ recipeId: "nope" })),
    );
    expect(Object.keys(blocked)).not.toContain("planId");
    expect(Object.keys(blocked)).not.toContain("recipeId");
    expect(Object.keys(blocked)).not.toContain("startedAt");
  });
});

describe("planExtraction malformed input never throws", () => {
  it("reports a non-list factTypes value instead of throwing", () => {
    const result = planExtraction(makeContext(), makeRequest({ factTypes: "price" as never }));
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(["invalid_fact_types"]);
    // The plan falls back to the recipe's declared targets; the error still blocks it.
    expect(result.data[0].targets).toEqual([...SUPPORTED_EXTRACTION_FACT_TYPES]);
  });

  it("reports an absent or incoherent definition instead of throwing", () => {
    expect(() => planExtraction(null as never, makeRequest())).not.toThrow();
    expect(
      planExtraction({ definition: null as never }, makeRequest()).errors.map(
        (error) => error.code,
      ),
    ).toEqual(["missing_plan_definition"]);
    const noRecipes = planExtraction(
      {
        definition: { identity: { id: "extr_x", slug: "x", name: "x" }, recipes: "nope" } as never,
      },
      makeRequest(),
    );
    expect(noRecipes.errors.map((error) => error.code)).toEqual(["unknown_recipe"]);
  });

  it("survives a malformed recipe: non-list stages, documentTypes, and fileFormats", () => {
    const definition = makeContext().definition;
    definition.recipes[0].stages = "nope" as never;
    definition.recipes[0].documentTypes = 5 as never;
    definition.recipes[0].fileFormats = 5 as never;
    let result: ReturnType<typeof planExtraction> | undefined;
    expect(() => {
      result = planExtraction({ definition }, makeRequest());
    }).not.toThrow();
    expect(result?.stats).toMatchObject({ stages: 0, steps: 0 });
  });

  it("treats a source with unusable identity or version as missing, never a degenerate id", () => {
    const noProject = makeSource();
    noProject.identity.projectId = undefined as never;
    expect(
      planExtraction(makeContext(), makeRequest({ source: noProject })).errors.map(
        (error) => error.code,
      ),
    ).toEqual(["missing_plan_source"]);

    const stringVersion = makeSource();
    stringVersion.version = "1.0.0" as never;
    const result = planExtraction(makeContext(), makeRequest({ source: stringVersion }));
    expect(result.errors.map((error) => error.code)).toEqual(["missing_plan_source"]);
    expect(JSON.stringify(result)).not.toContain("vundefined");
  });

  it("re-roots reused RC4.4 source issues under source. so one result speaks one path convention", () => {
    const incoherent = makeSource();
    incoherent.status = "published" as never;
    const result = planExtraction(makeContext(), makeRequest({ source: incoherent }));
    const issue = result.errors.find((error) => error.code === "unknown_source_status");
    expect(issue?.path).toBe("source.status");
  });

  it("derives history entries whose counters never alias the result", () => {
    const result = planExtraction(makeContext(), makeRequest());
    const entry = extractionPlanHistoryEntry(result);
    expect(entry.stats).toEqual(result.stats);
    expect(entry.stats).not.toBe(result.stats);
    entry.stats.completed = 999;
    expect(result.stats.completed).not.toBe(999);
  });
});
