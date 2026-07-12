import { describe, expect, it } from "vitest";

import type { CrossValidationContext, CrossValidationRequest } from "..";
import {
  describeCrossSourceReading,
  describeCrossSourceValidation,
  judgeCrossValidationConsensus,
  validateCrossValidationCatalog,
  validateCrossValidationFinding,
  validateCrossValidationReport,
} from "..";
import type { ExtractionFact } from "@/features/forever-extraction-pipeline";

import { makeContext, makeFact, makeRequest, runValidation } from "./fixtures";

describe("malformed input never throws", () => {
  it("reports an absent or project-less request instead of throwing", () => {
    for (const request of [
      undefined,
      null,
      {},
      { projectSlug: "" },
      { projectSlug: 42 },
    ] as never[]) {
      const result = describeCrossSourceValidation(makeContext(), request);
      expect(result.ok).toBe(false);
      expect(result.data).toEqual([]);
      expect(result.errors[0].code).toBe("missing_validation_project");
    }
  });

  it("reports a non-list facts value instead of throwing", () => {
    for (const facts of [undefined, null, "facts", 7, {}] as never[]) {
      const result = describeCrossSourceValidation(makeContext(), {
        projectSlug: "coralina",
        facts,
      });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe("invalid_validation_facts");
    }
  });

  it("survives an absent or malformed context", () => {
    for (const context of [undefined, null, {}, { sources: "nope" }, { requirements: 3 }]) {
      const result = describeCrossSourceValidation(
        context as never as CrossValidationContext,
        makeRequest(),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].standings).toHaveLength(2);
    }
  });

  it("reports malformed and duplicate registered sources and keeps examining", () => {
    const result = describeCrossSourceValidation(
      makeContext({
        sources: [null, {}, ...makeContext().sources!, ...makeContext().sources!] as never,
      }),
      makeRequest(),
    );
    expect(result.data).toHaveLength(1);
    const codes = result.warnings.map((issue) => issue.code);
    expect(codes).toContain("malformed_registered_source");
    expect(codes).toContain("duplicate_registered_source");
    expect(result.metadata.sourceCount).toBe(2);
  });

  it("marks holes, absent facts, and id-less facts inadmissible — never dropped", () => {
    const facts = [null, undefined, {}, { id: "x" }] as never[];
    const sparse: (ExtractionFact | undefined)[] = [makeFact()];
    sparse[3] = makeFact({ factSlug: "later" });
    const result = runValidation({}, { facts: [...facts, ...sparse] as ExtractionFact[] });
    const report = result.data[0];
    expect(report.standings).toHaveLength(8);
    expect(report.standings.slice(0, 4).map((standing) => standing.admissibility)).toEqual([
      "inadmissible",
      "inadmissible",
      "inadmissible",
      "inadmissible",
    ]);
    // The hole at slot 5 is accounted for too.
    expect(report.standings[5].admissibility).toBe("inadmissible");
    expect(report.standings[5].reason).toContain("malformed");
    expect(result.ok).toBe(false);
  });

  it("rejects a repeated fact id as inadmissible instead of double-examining it", () => {
    const result = runValidation({}, { facts: [makeFact(), makeFact()] });
    const report = result.data[0];
    expect(report.standings[0].admissibility).toBe("admissible");
    expect(report.standings[1].admissibility).toBe("inadmissible");
    expect(report.standings[1].reason).toContain("already examined");
  });

  it("rejects foreign-project facts and unknown fact types", () => {
    const foreign = makeFact({ projectSlug: "other" });
    const untyped = { ...makeFact({ factSlug: "untyped" }), factType: "mystery" as never };
    const result = runValidation({}, { facts: [foreign, untyped] });
    const report = result.data[0];
    expect(report.standings[0].reason).toContain("belongs to");
    expect(report.standings[1].reason).toContain("fact type");
    expect(report.subjects).toEqual([]);
  });

  it("excludes facts whose parts cannot be copied and reports them", () => {
    const exotic = makeFact({ factSlug: "exotic" }) as ExtractionFact & {
      sourceVersion: unknown;
    };
    exotic.sourceVersion = { major: 1, minor: 0, patch: 0, toJSON: () => "1.0.0" } as never;
    const cyclic = makeFact({ factSlug: "cyclic" }) as never as Record<string, unknown>;
    cyclic.structuredValue = cyclic;
    const result = runValidation({}, { facts: [exotic, cyclic as never] });
    expect(result.ok).toBe(false);
    expect(
      result.data[0].standings.every((standing) => standing.admissibility === "inadmissible"),
    ).toBe(true);
  });

  it("keeps consensus judgement total over malformed readings", () => {
    expect(judgeCrossValidationConsensus(null as never)).toEqual({ consensus: "unaddressed" });
    expect(judgeCrossValidationConsensus([null, undefined, {}] as never)).toEqual({
      consensus: "unaddressed",
    });
  });

  it("keeps the reading description total over deeply malformed facts", () => {
    const reading = describeCrossSourceReading({} as never);
    expect(reading.factId).toBe("");
    expect(reading.current).toBe(false);
    expect(reading.confidence).toEqual({ level: "unknown" });
  });

  it("validators report deeply malformed values instead of throwing", () => {
    expect(validateCrossValidationReport(null as never)[0].code).toBe("missing_report");
    expect(validateCrossValidationReport({} as never).length).toBeGreaterThan(0);
    expect(validateCrossValidationFinding(undefined as never)[0].code).toBe("missing_finding");
    expect(
      validateCrossValidationFinding({ kind: "conflict", references: "x" } as never).some(
        (issue) => issue.code === "invalid_finding_references",
      ),
    ).toBe(true);
    expect(validateCrossValidationCatalog({ id: "c", entries: null } as never)[0].code).toBe(
      "invalid_catalog_entries",
    );
  });

  it("ignores an empty stated batch with a warning", () => {
    const result = runValidation({}, { batch: "" as never });
    expect(result.data[0].id).toBe("xrep_coralina");
    expect(result.warnings.some((issue) => issue.code === "invalid_validation_batch")).toBe(true);
  });

  it("reports malformed requirement parts and demands nothing from them", () => {
    const result = describeCrossSourceValidation(
      makeContext({
        requirements: { expectedPaths: [42, "", "pricing.basePrice"] as never },
      }),
      makeRequest(),
    );
    expect(result.data).toHaveLength(1);
    expect(result.warnings.filter((issue) => issue.code === "invalid_expected_path")).toHaveLength(
      2,
    );
    // The one coherent expectation is honoured — and covered.
    expect(
      result.data[0].findings.filter((finding) => finding.kind === "missing_information"),
    ).toHaveLength(0);
  });
});

describe("structured never-throw entry points", () => {
  it("every public entry point tolerates garbage without throwing", () => {
    const garbage = [undefined, null, 0, "", [], {}, Symbol("x"), () => {}] as never[];
    for (const value of garbage) {
      expect(() =>
        describeCrossSourceValidation(value as never, value as never as CrossValidationRequest),
      ).not.toThrow();
      expect(() => validateCrossValidationReport(value as never)).not.toThrow();
      expect(() => validateCrossValidationFinding(value as never)).not.toThrow();
      expect(() => judgeCrossValidationConsensus(value as never)).not.toThrow();
    }
  });
});
