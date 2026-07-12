import { describe, expect, it } from "vitest";

import { projectSourceRelationships } from "@/features/forever-project-sources";

import type { CrossValidationRequest } from "..";
import { describeCrossSourceValidation, validateCrossValidationReport } from "..";
import {
  BROCHURE_ID,
  PRICE_LIST_ID,
  findingsOfKind,
  makeAgreeingFact,
  makeBrochureSource,
  makeConflictingFact,
  makeContext,
  makeFact,
  makePriceListSource,
  makeRequest,
  runValidation,
} from "./fixtures";

/**
 * Regression suite for the adversarial review: hostile input never escapes
 * as a throw, the engine never emits a report its own validator rejects,
 * stated absence participates instead of vanishing, supersession cycles are
 * described instead of electing losers, and messages state only what is
 * true.
 */
describe("hostile input never throws", () => {
  it("settles throwing accessors into structured failure results", () => {
    const hostile = () => {
      throw new Error("hostile");
    };
    const cases: [unknown, unknown][] = [
      [
        makeContext(),
        {
          get projectSlug() {
            return hostile();
          },
          facts: [],
        },
      ],
      [
        {
          get sources() {
            return hostile();
          },
        },
        makeRequest(),
      ],
      [
        {
          get now() {
            return hostile();
          },
        },
        makeRequest(),
      ],
      [
        {
          get requirements() {
            return hostile();
          },
        },
        makeRequest(),
      ],
    ];
    for (const [context, request] of cases) {
      const result = describeCrossSourceValidation(
        context as never,
        request as never as CrossValidationRequest,
      );
      expect(result.ok).toBe(false);
      expect(result.data).toEqual([]);
      expect(result.errors[0].code).toBe("unexaminable_input");
    }
  });

  it("excludes a single hostile fact instead of failing the batch", () => {
    const hostileFact = {
      get id(): string {
        throw new Error("hostile");
      },
    };
    const result = runValidation({}, { facts: [makeFact(), hostileFact as never] });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].standings[0].admissibility).toBe("admissible");
    expect(result.data[0].standings[1].admissibility).toBe("inadmissible");
  });

  it("excludes facts whose field path is a symbol instead of throwing", () => {
    const twisted = { ...makeFact(), fieldPath: Symbol("path") as never };
    const result = runValidation({}, { facts: [twisted] });
    expect(result.data[0].standings[0].admissibility).toBe("inadmissible");
    expect(result.data[0].standings[0].reason).toContain("field path");
  });

  it("ignores symbol-valued bars and clock with warnings instead of throwing", () => {
    const result = describeCrossSourceValidation(
      makeContext({
        now: Symbol("clock") as never,
        requirements: {
          minimumTrust: Symbol("trust") as never,
          minimumConfidence: Symbol("confidence") as never,
        },
      }),
      makeRequest(),
    );
    expect(result.data).toHaveLength(1);
    const codes = result.warnings.map((issue) => issue.code);
    expect(codes).toContain("invalid_validation_now");
    expect(codes).toContain("unknown_required_trust");
    expect(codes).toContain("unknown_required_confidence");
    expect(findingsOfKind(result, "authority_below_bar")).toEqual([]);
    expect(findingsOfKind(result, "confidence_below_bar")).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("detectedAt");
  });
});

describe("the engine never emits a report its own validator rejects", () => {
  const selfValidates = (result: ReturnType<typeof runValidation>) => {
    expect(result.data).toHaveLength(1);
    expect(validateCrossValidationReport(result.data[0])).toEqual([]);
  };

  it("holds across malformed-but-admitted shapes and excluded shapes alike", () => {
    const noVersion = { ...makeFact({ factSlug: "no-version" }) } as Record<string, unknown>;
    delete noVersion.sourceVersion;
    const batches: CrossValidationRequest["facts"][] = [
      [makeFact(), makeAgreeingFact()],
      [makeFact(), makeConflictingFact()],
      [noVersion as never],
      [makeFact({ factSlug: "empty-path", fieldPath: "" })],
      [makeFact({ factSlug: "empty-unit", unit: "" })],
      [makeFact({ factSlug: "blank-language", language: " " })],
      [makeFact({ factSlug: "empty-currency", structuredValue: { amount: 1, currency: "" } })],
      [makeFact({ factSlug: "bad-score", confidence: { level: "high", score: 5 } })],
      [null as never, {} as never],
    ];
    for (const facts of batches) {
      selfValidates(runValidation({}, { facts }));
    }
  });

  it("holds for degenerate context values", () => {
    selfValidates(runValidation({ now: "" as never }));
    selfValidates(
      runValidation({
        sources: [
          { identity: { id: PRICE_LIST_ID } } as never,
          makePriceListSource({ status: "bogus" as never }),
          makeBrochureSource({ authority: { kind: "weird", trust: "nope" } as never }),
        ],
      }),
    );
    // A slug that survives normalization as nothing is a failure, not a
    // degenerate report.
    const degenerate = runValidation({}, { projectSlug: "!!!" });
    expect(degenerate.ok).toBe(false);
    expect(degenerate.data).toEqual([]);
    expect(degenerate.errors[0].code).toBe("missing_validation_project");
  });

  it("excludes facts the reused confidence and revision guards judge incoherent", () => {
    const noVersion = { ...makeFact({ factSlug: "no-version" }) } as Record<string, unknown>;
    delete noVersion.sourceVersion;
    const result = runValidation(
      {},
      {
        facts: [
          noVersion as never,
          makeFact({ factSlug: "bad-score", confidence: { level: "high", score: 5 } }),
          makeFact({ factSlug: "unknown-scored", confidence: { level: "unknown", score: 0.5 } }),
        ],
      },
    );
    expect(result.data[0].standings.map((standing) => standing.admissibility)).toEqual([
      "inadmissible",
      "inadmissible",
      "inadmissible",
    ]);
    expect(result.data[0].standings[0].reason).toContain("revision");
    expect(result.data[0].standings[1].reason).toContain("confidence");
  });
});

describe("stated absence participates — never silence", () => {
  const ABSENT = () =>
    makeAgreeingFact({
      factSlug: "price-absent",
      status: "unavailable",
      rawValue: undefined,
      structuredValue: undefined,
      excerpt: undefined,
      locator: undefined,
    });

  it("describes a value against a stated absence as a conflict, like the RC4.6 merge", () => {
    const result = runValidation({}, { facts: [makeFact(), ABSENT()] });
    const report = result.data[0];
    const conflicts = findingsOfKind(result, "conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].message).toContain("state the value is absent");
    expect(report.subjects[0].consensus).toBe("contested");
    // Both sides — including the stated absence — are marked for review.
    expect(report.standings.map((standing) => standing.admissibility)).toEqual([
      "requires_review",
      "requires_review",
    ]);
  });

  it("lets independent sources corroborate a stated absence", () => {
    const absentFromPriceList = makeFact({
      factSlug: "price-absent-list",
      status: "unavailable",
      rawValue: undefined,
      structuredValue: undefined,
    });
    const result = runValidation({}, { facts: [absentFromPriceList, ABSENT()] });
    expect(result.data[0].subjects[0].consensus).toBe("corroborated");
    expect(findingsOfKind(result, "agreement")).toHaveLength(1);
  });

  it("describes an expected path covered only by stated absence as missing information", () => {
    const result = runValidation(
      { requirements: { expectedPaths: ["pricing.basePrice"] } },
      { facts: [ABSENT()] },
    );
    const missing = findingsOfKind(result, "missing_information");
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain("sources' own statement");
    expect(missing[0].references.some((reference) => reference.factId !== undefined)).toBe(true);
    // The subject stays assessed by the fact itself — no pseudo-subject.
    expect(result.data[0].subjects).toHaveLength(1);
    expect(result.data[0].subjects[0].subject.factType).toBe("price");
    expect(validateCrossValidationReport(result.data[0])).toEqual([]);
  });
});

describe("supersession cycles are described, not resolved", () => {
  it("keeps both readings standing and reports the contradictory chain", () => {
    const cyclicA = makePriceListSource({
      relationships: projectSourceRelationships({ supersededBy: BROCHURE_ID }),
    });
    const cyclicB = makeBrochureSource({
      relationships: projectSourceRelationships({ supersededBy: PRICE_LIST_ID }),
    });
    const result = runValidation(
      { sources: [cyclicA, cyclicB] },
      { facts: [makeFact(), makeConflictingFact()] },
    );
    const report = result.data[0];
    // Nobody is elected outdated: the disagreement stays a described
    // conflict, and the cycle itself is a reference inconsistency.
    expect(findingsOfKind(result, "stale_revision")).toEqual([]);
    const inconsistencies = findingsOfKind(result, "inconsistency");
    expect(inconsistencies).toHaveLength(1);
    expect(inconsistencies[0].dimension).toBe("reference");
    expect(inconsistencies[0].message).toContain("supersession cycle");
    expect(findingsOfKind(result, "conflict")).toHaveLength(1);
    expect(report.subjects[0].consensus).toBe("contested");
    expect(validateCrossValidationReport(report)).toEqual([]);
  });
});

describe("messages state only what is true", () => {
  it("names a single source disagreeing with itself, not plural sources", () => {
    const result = runValidation(
      {},
      {
        facts: [
          makeFact(),
          makeFact({
            factSlug: "price-1br-second-look",
            rawValue: "THB 4,990,000",
            structuredValue: { amount: 4990000, currency: "THB" },
          }),
        ],
      },
    );
    const conflicts = findingsOfKind(result, "conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].message).toContain("disagrees with itself");
    expect(conflicts[0].independentSources).toBe(false);
  });
});
