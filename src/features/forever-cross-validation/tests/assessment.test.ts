import { describe, expect, it } from "vitest";

import type { CrossSourceReading } from "..";
import {
  distinctCrossReadingSignatures,
  distinctCrossReadingSources,
  judgeCrossValidationConsensus,
  listCurrentCrossSourceReadings,
} from "..";
import {
  BROCHURE_ID,
  PRICE_LIST_ID,
  TRANSLATION_ID,
  makeBrochureSource,
  makeSources,
  makeTranslationSource,
} from "./fixtures";

function reading(overrides: Partial<CrossSourceReading> = {}): CrossSourceReading {
  return {
    factId: "xfact_a",
    sourceId: PRICE_LIST_ID,
    sourceVersion: { major: 1, minor: 0, patch: 0 },
    signature: "sig-a",
    confidence: { level: "unknown" },
    current: true,
    statesAbsence: false,
    registered: false,
    ...overrides,
  };
}

describe("judgeCrossValidationConsensus", () => {
  it("is unaddressed with no current reading", () => {
    expect(judgeCrossValidationConsensus([])).toEqual({ consensus: "unaddressed" });
    expect(judgeCrossValidationConsensus([reading({ current: false })])).toEqual({
      consensus: "unaddressed",
    });
  });

  it("is uncorroborated for one source, however many readings", () => {
    expect(
      judgeCrossValidationConsensus([reading(), reading({ factId: "xfact_b" })]).consensus,
    ).toBe("uncorroborated");
  });

  it("is corroborated when two independent sources share one signature", () => {
    expect(
      judgeCrossValidationConsensus(
        [reading(), reading({ factId: "xfact_b", sourceId: BROCHURE_ID })],
        makeSources(),
      ).consensus,
    ).toBe("corroborated");
  });

  it("does not corroborate across declared relationship chains", () => {
    const dependent = judgeCrossValidationConsensus(
      [
        reading({ sourceId: BROCHURE_ID }),
        reading({ factId: "xfact_b", sourceId: TRANSLATION_ID }),
      ],
      [makeBrochureSource(), makeTranslationSource()],
    );
    expect(dependent.consensus).toBe("uncorroborated");
    // Without the declared relationship in hand, distinct ids judge as
    // independent — the declaration-or-nothing rule.
    const undeclared = judgeCrossValidationConsensus([
      reading({ sourceId: BROCHURE_ID }),
      reading({ factId: "xfact_b", sourceId: TRANSLATION_ID }),
    ]);
    expect(undeclared.consensus).toBe("corroborated");
  });

  it("is contested when comparable readings disagree", () => {
    expect(
      judgeCrossValidationConsensus([
        reading(),
        reading({ factId: "xfact_b", sourceId: BROCHURE_ID, signature: "sig-b" }),
      ]).consensus,
    ).toBe("contested");
  });

  it("is incomparable across differing units, before any value judgement", () => {
    const verdict = judgeCrossValidationConsensus([
      reading({ unit: "sqm" }),
      reading({ factId: "xfact_b", sourceId: BROCHURE_ID, unit: "sqft", signature: "sig-b" }),
    ]);
    expect(verdict).toEqual({ consensus: "incomparable", dimension: "unit" });
    // A declared unit meeting an undeclared one is incomparable too.
    expect(
      judgeCrossValidationConsensus([
        reading({ unit: "sqm" }),
        reading({ factId: "xfact_b", sourceId: BROCHURE_ID }),
      ]),
    ).toEqual({ consensus: "incomparable", dimension: "unit" });
  });

  it("is incomparable across differing currencies", () => {
    expect(
      judgeCrossValidationConsensus([
        reading({ currency: "THB" }),
        reading({ factId: "xfact_b", sourceId: BROCHURE_ID, currency: "USD", signature: "s" }),
      ]),
    ).toEqual({ consensus: "incomparable", dimension: "currency" });
  });

  it("is incomparable across differing languages only when the readings disagree", () => {
    const agreeing = judgeCrossValidationConsensus(
      [
        reading({ language: "en" }),
        reading({ factId: "xfact_b", sourceId: BROCHURE_ID, language: "th" }),
      ],
      makeSources(),
    );
    // Byte-identical readings agree regardless of declared language.
    expect(agreeing.consensus).toBe("corroborated");
    const disagreeing = judgeCrossValidationConsensus([
      reading({ language: "en" }),
      reading({ factId: "xfact_b", sourceId: BROCHURE_ID, language: "th", signature: "sig-b" }),
    ]);
    expect(disagreeing).toEqual({ consensus: "incomparable", dimension: "language" });
  });

  it("compares a stated absence by its signature alone — not by units or currencies", () => {
    // A monetary value against a stated absence is a contest of existence,
    // never a currency incomparability: the absence declares no currency.
    expect(
      judgeCrossValidationConsensus([
        reading({ currency: "THB" }),
        reading({
          factId: "xfact_b",
          sourceId: BROCHURE_ID,
          signature: "sig-absent",
          statesAbsence: true,
        }),
      ]).consensus,
    ).toBe("contested");
    // Two sources stating the same absence corroborate it.
    expect(
      judgeCrossValidationConsensus([
        reading({ signature: "sig-absent", statesAbsence: true }),
        reading({
          factId: "xfact_b",
          sourceId: BROCHURE_ID,
          signature: "sig-absent",
          statesAbsence: true,
        }),
      ]).consensus,
    ).toBe("corroborated");
  });

  it("sets non-current readings aside from every judgement", () => {
    expect(
      judgeCrossValidationConsensus([
        reading(),
        reading({
          factId: "xfact_b",
          sourceId: BROCHURE_ID,
          signature: "sig-b",
          current: false,
        }),
      ]).consensus,
    ).toBe("uncorroborated");
  });
});

describe("reading collectors", () => {
  it("collects current readings, sources, and signatures in stable order", () => {
    const readings = [
      reading(),
      reading({ factId: "xfact_b", sourceId: BROCHURE_ID, signature: "sig-b" }),
      reading({ factId: "xfact_c", current: false, signature: "sig-c" }),
    ];
    expect(listCurrentCrossSourceReadings(readings)).toHaveLength(2);
    expect(distinctCrossReadingSources(readings)).toEqual([PRICE_LIST_ID, BROCHURE_ID]);
    expect(distinctCrossReadingSignatures(readings)).toEqual(["sig-a", "sig-b", "sig-c"]);
  });
});
