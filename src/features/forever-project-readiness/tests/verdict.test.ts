import { describe, expect, it } from "vitest";

import {
  READINESS_STANDINGS,
  READINESS_VERDICTS,
  isKnownReadinessStanding,
  isKnownReadinessVerdict,
  pickReadinessSubjectStanding,
  readinessStandingFor,
} from "..";
import type { ReadinessEvaluation } from "..";

function evaluation(overrides: Partial<ReadinessEvaluation> = {}): ReadinessEvaluation {
  return {
    id: "reva_coralina-field-present-1",
    requirement: { kind: "field_present", path: "pricing.basePrice", necessity: "required" },
    verdict: "met",
    reason: "stated",
    references: [{ path: "pricing.basePrice" }],
    ...overrides,
  };
}

describe("verdict and standing vocabularies", () => {
  it("declares the closed vocabularies with guards", () => {
    expect(READINESS_VERDICTS).toEqual(["met", "unmet", "indeterminate"]);
    expect(READINESS_STANDINGS).toEqual(["ready", "blocked", "indeterminate"]);
    expect(isKnownReadinessVerdict("met")).toBe(true);
    expect(isKnownReadinessVerdict("passed")).toBe(false);
    expect(isKnownReadinessStanding("blocked")).toBe(true);
    expect(isKnownReadinessStanding("approved")).toBe(false);
  });
});

describe("readinessStandingFor", () => {
  it("never presumes readiness from an empty or unreadable examination", () => {
    expect(readinessStandingFor([])).toBe("indeterminate");
    expect(readinessStandingFor(undefined as unknown as ReadinessEvaluation[])).toBe(
      "indeterminate",
    );
    expect(readinessStandingFor([null, "junk"] as unknown as ReadinessEvaluation[])).toBe(
      "indeterminate",
    );
  });

  it("is ready only when every required statement is met", () => {
    expect(readinessStandingFor([evaluation()])).toBe("ready");
    expect(readinessStandingFor([evaluation(), evaluation({ verdict: "unmet" })])).toBe("blocked");
    expect(readinessStandingFor([evaluation(), evaluation({ verdict: "indeterminate" })])).toBe(
      "indeterminate",
    );
  });

  it("one unmet required statement blocks, whatever else stands", () => {
    expect(
      readinessStandingFor([
        evaluation({ verdict: "indeterminate" }),
        evaluation({ verdict: "unmet" }),
      ]),
    ).toBe("blocked");
  });

  it("an explicit recommended statement never blocks", () => {
    const advisory = evaluation({
      requirement: { kind: "field_present", path: "a", necessity: "recommended" },
      verdict: "unmet",
    });
    expect(readinessStandingFor([evaluation(), advisory])).toBe("ready");
    expect(readinessStandingFor([advisory])).toBe("ready");
  });

  it("a malformed necessity demands — it never quietly excuses", () => {
    const malformed = evaluation({
      requirement: {
        kind: "field_present",
        path: "a",
        necessity: "optional",
      } as unknown as ReadinessEvaluation["requirement"],
      verdict: "unmet",
    });
    expect(readinessStandingFor([malformed])).toBe("blocked");
  });

  it("a verdict outside the vocabulary is never trusted as met", () => {
    const hostile = evaluation({
      verdict: "approved" as unknown as ReadinessEvaluation["verdict"],
    });
    expect(readinessStandingFor([hostile])).toBe("indeterminate");
  });
});

describe("pickReadinessSubjectStanding", () => {
  it("keeps the most demanding observation standing", () => {
    expect(pickReadinessSubjectStanding(["corroborated", "disputed"])).toBe("disputed");
    expect(pickReadinessSubjectStanding(["unverified", "incomparable"])).toBe("incomparable");
    expect(pickReadinessSubjectStanding(["unverified", "corroborated"])).toBe("corroborated");
    expect(pickReadinessSubjectStanding(["missing", "unverified"])).toBe("missing");
    expect(pickReadinessSubjectStanding([])).toBeUndefined();
  });
});
