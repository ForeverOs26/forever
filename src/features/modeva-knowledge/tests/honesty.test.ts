import { describe, expect, it } from "vitest";

import { buildProjectKnowledgeSlice } from "@/features/forever-project-knowledge";

import { MODEVA_KNOWLEDGE_DEFINITION } from "../definition";
import { MODEVA_EXPECTED_MISSING_PATHS, MODEVA_UNIT_TYPE_LABELS } from "../facts";

const slice = buildProjectKnowledgeSlice(MODEVA_KNOWLEDGE_DEFINITION);

describe("Modeva anti-fabrication honesty", () => {
  it("keeps every declared-missing path out of the canonical record", () => {
    const recordPaths = new Set(slice.canonical.record.fields.map((field) => field.path));
    for (const gap of MODEVA_EXPECTED_MISSING_PATHS) {
      expect(recordPaths.has(gap.path)).toBe(false);
    }
  });

  it("states no amenity, rental, price, or coordinates fact — no source states them", () => {
    for (const fact of slice.extraction.facts) {
      expect(fact.fieldPath?.startsWith("amenities.")).toBe(false);
      expect(fact.fieldPath?.startsWith("rental.")).toBe(false);
      expect(fact.fieldPath).not.toBe("location.coordinates");
      expect(fact.factType).not.toBe("price");
    }
  });

  it("does not transcribe the seed's placeholder strings as facts", () => {
    // The canonical seed carries display placeholders ("Under Review",
    // "Awaiting full Forever inspection data", trust score 0). None may
    // become a fact — the seed is saying it does not know.
    for (const fact of slice.extraction.facts) {
      expect(fact.rawValue).not.toBe("Under Review");
      expect(fact.rawValue).not.toBe("Under review");
      expect(fact.rawValue?.includes("Awaiting")).not.toBe(true);
    }
  });

  it("keeps every fact's evidence traceable to its committed artifact", () => {
    for (const fact of slice.extraction.facts) {
      expect(fact.evidence.locator?.detail ?? "").not.toBe("");
      expect(fact.provenance.method.tool ?? "").toMatch(/^(supabase\/migrations|docs)\//);
    }
  });

  it("keeps single-source unit data uncorroborated instead of inventing agreement", () => {
    const unitTypes = slice.crossValidation.report.subjects.find(
      (subject) => subject.subject.fieldPath === "units.unitTypes",
    );
    expect(unitTypes?.consensus).toBe("uncorroborated");
    expect(unitTypes?.readings).toHaveLength(1);
    // The vocabulary itself is verbatim — 16 labels from the 289 rows.
    expect(MODEVA_UNIT_TYPE_LABELS).toHaveLength(16);
  });

  it("reports the missing intake package as the readiness blocker, not as data", () => {
    const blockerSubjects = slice.readiness.report.evaluations
      .filter((evaluation) => evaluation.verdict === "unmet")
      .map((evaluation) => evaluation.requirement.kind);
    expect(blockerSubjects).toContain("source_present");
  });
});
