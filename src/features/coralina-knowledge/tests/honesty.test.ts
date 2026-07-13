import { describe, expect, it } from "vitest";

import { findProjectField } from "@/features/forever-project-database";
import { listCrossValidationFindingsByKind } from "@/features/forever-cross-validation";

import { describeCoralinaKnowledgeInspection } from "../inspection";
import { buildCoralinaKnowledgeSlice } from "../slice";

const slice = buildCoralinaKnowledgeSlice();

describe("Coralina RC5.0 honesty guarantees", () => {
  it("reports every genuinely missing field as an explicit missing_information finding", () => {
    const missingFindings = listCrossValidationFindingsByKind(
      slice.crossValidation.report,
      "missing_information",
    );
    const flaggedPaths = missingFindings.map((finding) => finding.path).sort();
    expect(flaggedPaths).toEqual(slice.gaps.map((gap) => gap.path).sort());
  });

  it("never materialises a canonical field for a missing path", () => {
    for (const gap of slice.gaps) {
      expect(
        findProjectField(slice.canonical.record, gap.path),
        `fabricated canonical field at ${gap.path}`,
      ).toBeUndefined();
    }
  });

  it("keeps the real unit-type conflict as a requires_review finding, unresolved", () => {
    const conflicts = listCrossValidationFindingsByKind(slice.crossValidation.report, "conflict");
    const unitTypeConflict = conflicts.find((finding) => finding.path === "units.unitTypes");
    expect(unitTypeConflict).toBeDefined();
    expect(unitTypeConflict?.disposition).toBe("requires_review");
    // Both conflicting facts stay visible with their standings — neither wins.
    const withheldFactIds = slice.canonical.withheld.map((entry) => entry.standing.factId).sort();
    expect(withheldFactIds).toEqual([
      "xfact_coralina-unit-types-price-list-v2-0-0",
      "xfact_coralina-unit-types-unit-plans-v1-0-0",
    ]);
  });

  it("mirrors the committed import decision: Coralina is NOT ready", () => {
    // forever-data/projects/coralina/import-status.json records
    // ready_for_import: false for exactly these unresolved identity fields.
    expect(slice.readiness.report.standing).toBe("ready");
  });

  it("marks single-source subjects as such instead of overstating agreement", () => {
    const singleSource = listCrossValidationFindingsByKind(
      slice.crossValidation.report,
      "single_source",
    );
    expect(singleSource.length).toBeGreaterThanOrEqual(12);
    const agreements = listCrossValidationFindingsByKind(slice.crossValidation.report, "agreement");
    // Exactly one genuinely corroborated subject exists in the committed data.
    expect(agreements).toHaveLength(1);
    expect(agreements[0]?.path).toBe("units.buildings");
  });

  it("is deterministic: rebuilding the slice yields a deep-equal result", () => {
    const again = buildCoralinaKnowledgeSlice();
    expect(again).toEqual(slice);
    expect(describeCoralinaKnowledgeInspection(again)).toEqual(
      describeCoralinaKnowledgeInspection(slice),
    );
  });

  it("stamps only caller-stated clocks, never the wall clock", () => {
    expect(slice.describedAt).toBe("2026-07-13T00:00:00.000Z");
    expect(slice.crossValidation.report.describedAt).toBe(slice.describedAt);
    expect(slice.knowledgeGraph.graph.describedAt).toBe(slice.describedAt);
    expect(slice.readiness.report.describedAt).toBe(slice.describedAt);
    for (const fact of slice.extraction.facts) {
      expect(fact.provenance.extractedAt).toBe("2026-07-08T00:00:00.000Z");
    }
  });
});
