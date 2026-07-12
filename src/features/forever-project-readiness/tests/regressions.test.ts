import { describe, expect, it } from "vitest";

import type { ProjectField } from "@/features/forever-project-database";

import { listReadinessEvaluationsByKind, validateReadinessReport } from "..";
import {
  BROCHURE_ID,
  PRICE_PATH,
  makeAgreeingFact,
  makeConflictingFact,
  makeFact,
  makeRecordWithValues,
  makeReport,
  runReadiness,
} from "./fixtures";

/**
 * Pins for defects found (or nearly shipped) during the adversarial review
 * of RC4.9. Each test names the failure mode it guards against; none of
 * these behaviours may regress silently.
 */
describe("adversarial-review regressions", () => {
  it("a field carrying a non-list value history still judges cleanly, never via the hostility net", () => {
    // Found in review: the stated-absence walk read `field.values.length`
    // unguarded, so a malformed history fell into the generic per-statement
    // catch and settled `indeterminate` with a hostility reason instead of a
    // clean `unmet` judgement.
    const record = makeRecordWithValues([]);
    (record.fields[0] as ProjectField as { values: unknown }).values = "junk";
    const result = runReadiness(
      { record },
      { requirements: [{ kind: "field_present", path: PRICE_PATH }] },
    );
    const evaluation = result.data[0].evaluations[0];
    expect(evaluation.verdict).toBe("unmet");
    expect(evaluation.reason).toContain("no current entry");
    expect(evaluation.reason).not.toContain("could not be examined");
    expect(validateReadinessReport(result.data[0])).toEqual([]);
  });

  it("demand signatures join outside every vocabulary — a spaced path never collides", () => {
    // Nearly shipped: the signature originally joined with a space, so the
    // demand "findings_clear at path `a b`" collided with distinct demands
    // whose joined parts happened to read the same.
    const result = runReadiness(
      {},
      {
        requirements: [
          { kind: "findings_clear", path: "a b" },
          { kind: "findings_clear", path: "a" },
        ],
      },
    );
    expect(result.data[0].evaluations).toHaveLength(2);
    expect(result.data[0].slots.every((slot) => slot.admissibility === "evaluated")).toBe(true);
  });

  it("duplicate detection judges the normalized demand, not the raw statement", () => {
    // An extraneous parameter is stripped at intake, so a statement that
    // differs only by stripped noise is the same demand — evaluated once,
    // and the restatement is set aside with a reason.
    const result = runReadiness(
      {},
      {
        requirements: [
          { kind: "field_present", path: PRICE_PATH, minimumConfidence: "high" },
          { kind: "field_present", path: PRICE_PATH },
        ],
      },
    );
    const report = result.data[0];
    expect(report.evaluations).toHaveLength(1);
    expect(report.slots[1].admissibility).toBe("inadmissible");
    expect(report.slots[1].reason).toContain("already stated");
  });

  it('"verified" is a document status, not a trust rung — the demand is inadmissible', () => {
    // Found in review: the RC4.4 status vocabulary (`verified`) reads like a
    // trust level, but the reused RC3.3 trust ladder is
    // unverified/low/standard/high/authoritative. A confused statement must
    // be set aside as incoherent, never quietly treated as a no-bar.
    const result = runReadiness(
      {},
      {
        requirements: [
          { kind: "source_present", documentType: "price_list", minimumTrust: "verified" as never },
        ],
      },
    );
    expect(result.data[0].slots[0].admissibility).toBe("inadmissible");
    expect(result.data[0].slots[0].reason).toContain("unknown trust rung");
  });

  it("when several subjects address one path, the most demanding judgement wins", () => {
    // A corroborated price and a contested area can share one canonical
    // path (subjects differ by fact type). Corroboration must not be
    // claimed while any judgement of the path stands in review.
    const facts = [
      makeFact(),
      makeAgreeingFact(),
      makeFact({
        factSlug: "area-a",
        factType: "total_area",
        rawValue: "45 sqm",
        structuredValue: 45,
        unit: "sqm",
      }),
      makeFact({
        factSlug: "area-b",
        factType: "total_area",
        sourceId: BROCHURE_ID,
        rawValue: "48 sqm",
        structuredValue: 48,
        unit: "sqm",
      }),
    ];
    const report = runReadiness(
      { report: makeReport(facts) },
      {
        requirements: [
          { kind: "field_corroborated", path: PRICE_PATH },
          { kind: "field_uncontested", path: PRICE_PATH },
        ],
      },
    ).data[0];
    const corroborated = listReadinessEvaluationsByKind(report, "field_corroborated")[0];
    expect(corroborated.verdict).toBe("unmet");
    expect(corroborated.standing).toBe("disputed");
    const uncontested = listReadinessEvaluationsByKind(report, "field_uncontested")[0];
    expect(uncontested.verdict).toBe("unmet");
  });

  it("a report whose every statement is inadmissible never stands ready", () => {
    // Readiness is a judgement over evaluations; zero coherent evaluations
    // must settle the explicit `indeterminate`, never a vacuous `ready`.
    const result = runReadiness(
      {},
      { requirements: [null as never, { kind: "blessed" } as never] },
    );
    expect(result.ok).toBe(false);
    const report = result.data[0];
    expect(report.evaluations).toEqual([]);
    expect(report.standing).toBe("indeterminate");
    expect(validateReadinessReport(report)).toEqual([]);
  });

  it("a contested then re-corroborated path flips the gate exactly with the examination", () => {
    // The gate must follow the examination it reuses — no memory, no local
    // judgement: the same statements against a contested report block, and
    // against an agreeing report stand ready.
    const statements = {
      requirements: [
        { kind: "field_corroborated" as const, path: PRICE_PATH },
        { kind: "field_uncontested" as const, path: PRICE_PATH },
      ],
    };
    const contested = runReadiness(
      { report: makeReport([makeFact(), makeConflictingFact()]) },
      statements,
    ).data[0];
    expect(contested.standing).toBe("blocked");
    const agreed = runReadiness(
      { report: makeReport([makeFact(), makeAgreeingFact()]) },
      statements,
    ).data[0];
    expect(agreed.standing).toBe("ready");
  });
});
