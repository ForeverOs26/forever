import { describe, expect, it } from "vitest";

import type { ExtractionFact } from "@/features/forever-extraction-pipeline";
import {
  describeProjectField,
  describeProjectMerge,
  describeProjectRecord,
  projectFieldValueFromFact,
  projectRecordVersion,
} from "@/features/forever-project-database";

import { makeAgreeingFact, makeConflictingFact, makeFact, runValidation } from "./fixtures";

/** The canonical RC4.6 record after the base fact settled at its path. */
function recordFrom(fact: ExtractionFact) {
  return describeProjectRecord({
    projectSlug: "coralina",
    version: projectRecordVersion(1, 0, 0),
    fields: [
      describeProjectField({
        projectSlug: "coralina",
        path: fact.fieldPath!,
        values: [projectFieldValueFromFact(fact)],
      }),
    ],
  });
}

/**
 * The architectural contract of RC4.7: because readings are compared through
 * the reused RC4.6 signature bridge, this examination's judgement can never
 * disagree with the judgement the canonical merge makes when the very same
 * facts arrive there.
 */
describe("RC4.6 bridge coherence", () => {
  it("judges a cross-source disagreement exactly as the canonical merge does", () => {
    const base = makeFact();
    const disagreeing = makeConflictingFact();
    expect(runValidation({}, { facts: [base, disagreeing] }).data[0].subjects[0].consensus).toBe(
      "contested",
    );
    const merge = describeProjectMerge({ record: recordFrom(base) }, { facts: [disagreeing] });
    expect(merge.data[0].entries[0].kind).toBe("conflicting");
    expect(merge.data[0].conflicts).toHaveLength(1);
  });

  it("judges cross-source agreement exactly as the canonical merge does", () => {
    const base = makeFact();
    const agreeing = makeAgreeingFact();
    expect(runValidation({}, { facts: [base, agreeing] }).data[0].subjects[0].consensus).toBe(
      "corroborated",
    );
    const merge = describeProjectMerge({ record: recordFrom(base) }, { facts: [agreeing] });
    expect(merge.data[0].entries[0].kind).toBe("unchanged");
    expect(merge.data[0].conflicts).toEqual([]);
  });

  it("judges a stated absence against a value exactly as the canonical merge does", () => {
    const base = makeFact();
    const absent = makeAgreeingFact({
      factSlug: "price-absent",
      status: "unavailable",
      rawValue: undefined,
      structuredValue: undefined,
    });
    expect(runValidation({}, { facts: [base, absent] }).data[0].subjects[0].consensus).toBe(
      "contested",
    );
    const merge = describeProjectMerge({ record: recordFrom(base) }, { facts: [absent] });
    expect(merge.data[0].entries[0].kind).toBe("conflicting");
  });
});
