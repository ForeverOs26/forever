import { describe, expect, it } from "vitest";

import {
  compareCrossValidationSourceVersionTotal,
  compareCrossValidationStrings,
  distinctCrossSourceRefs,
  isWellFormedCrossValidationSourceVersion,
  listCrossFactStandings,
} from "..";
import { BROCHURE_ID, PRICE_LIST_ID, makeAgreeingFact, makeFact, makeReport } from "./fixtures";

describe("helpers", () => {
  it("compares strings by code unit, totally", () => {
    expect(compareCrossValidationStrings("a", "b")).toBeLessThan(0);
    expect(compareCrossValidationStrings("b", "a")).toBeGreaterThan(0);
    expect(compareCrossValidationStrings("a", "a")).toBe(0);
    expect(compareCrossValidationStrings(undefined, "a")).toBeLessThan(0);
    expect(compareCrossValidationStrings(3, null)).toBeGreaterThan(0);
  });

  it("collects distinct source refs in first-seen order, defensively", () => {
    expect(
      distinctCrossSourceRefs([makeFact(), makeAgreeingFact(), makeFact(), null as never]),
    ).toEqual([PRICE_LIST_ID, BROCHURE_ID]);
    expect(distinctCrossSourceRefs(null as never)).toEqual([]);
  });

  it("lists standings by admissibility", () => {
    const report = makeReport();
    expect(listCrossFactStandings(report.standings, "admissible")).toHaveLength(2);
    expect(listCrossFactStandings(report.standings, "inadmissible")).toEqual([]);
    expect(listCrossFactStandings(null as never, "admissible")).toEqual([]);
  });

  it("guards well-formed versions and compares them totally", () => {
    expect(isWellFormedCrossValidationSourceVersion({ major: 1, minor: 0, patch: 0 })).toBe(true);
    for (const bad of [
      null,
      undefined,
      {},
      { major: 1 },
      { major: "1", minor: 0, patch: 0 },
      { major: NaN, minor: 0, patch: 0 },
    ]) {
      expect(isWellFormedCrossValidationSourceVersion(bad)).toBe(false);
    }
    expect(
      compareCrossValidationSourceVersionTotal(
        { major: 2, minor: 0, patch: 0 },
        { major: 1, minor: 9, patch: 9 },
      ),
    ).toBeGreaterThan(0);
    expect(compareCrossValidationSourceVersionTotal(null, { major: 1, minor: 0, patch: 0 })).toBe(
      0,
    );
  });
});
