import { describe, expect, it } from "vitest";

import {
  projectFieldValue,
  projectFieldValueFromFact,
  projectFieldValueSignature,
  unknownProjectConfidence,
} from "..";
import { makeFact, makeValue } from "./fixtures";

describe("canonical value builder", () => {
  it("attaches only what was supplied, defaulting confidence to the explicit unknown", () => {
    const bare = projectFieldValue("current", { rawValue: "42" });
    expect(bare).toEqual({ status: "current", rawValue: "42", confidence: { level: "unknown" } });
    expect(bare.confidence).toEqual(unknownProjectConfidence());
    expect("unit" in bare).toBe(false);
    expect("evidence" in bare).toBe(false);
    expect("recordedAt" in bare).toBe(false);
  });

  it("never aliases the caller's input", () => {
    const evidence = [{ sourceId: "psrc_x" }];
    const value = projectFieldValue("current", { rawValue: "42", evidence });
    expect(value.evidence).toEqual(evidence);
    expect(value.evidence).not.toBe(evidence);
    value.evidence?.push({ sourceId: "psrc_y" });
    expect(evidence).toHaveLength(1);
  });
});

describe("settling a fact into a canonical value", () => {
  it("copies the fact's value, confidence, evidence, and provenance verbatim", () => {
    const fact = makeFact();
    const value = projectFieldValueFromFact(fact);
    expect(value.status).toBe("current");
    expect(value.rawValue).toBe(fact.rawValue);
    expect(value.structuredValue).toEqual(fact.structuredValue);
    expect(value.language).toBe(fact.language);
    expect(value.confidence).toEqual(fact.confidence);
    expect(value.factId).toBe(fact.id);
    expect(value.sourceIds).toEqual([fact.sourceId]);
    expect(value.evidence).toEqual([fact.evidence]);
    expect(value.provenance).toEqual(fact.provenance);
  });

  it("is deterministic and never aliases the fact (anti-aliasing)", () => {
    const fact = makeFact();
    expect(projectFieldValueFromFact(fact)).toEqual(projectFieldValueFromFact(fact));
    const value = projectFieldValueFromFact(fact);
    expect(value.confidence).not.toBe(fact.confidence);
    expect(value.provenance).not.toBe(fact.provenance);
    expect(value.evidence?.[0]).not.toBe(fact.evidence);
    expect(value.structuredValue).not.toBe(fact.structuredValue);
    value.provenance!.sourceId = "psrc_mutated";
    expect(fact.provenance.sourceId).toBe("psrc_coralina-price-list-v1-0-0");
  });

  it("settles an unavailable fact into an explicit missing entry with no value", () => {
    const fact = makeFact({
      rawValue: undefined,
      structuredValue: undefined,
      status: "unavailable",
    });
    const value = projectFieldValueFromFact(fact);
    expect(value.status).toBe("missing");
    expect("rawValue" in value).toBe(false);
    expect("structuredValue" in value).toBe(false);
    expect(value.factId).toBe(fact.id);
    expect(value.provenance).toEqual(fact.provenance);
  });

  it("never fabricates a recorded time — the extraction time stays in provenance", () => {
    const value = projectFieldValueFromFact(makeFact());
    expect("recordedAt" in value).toBe(false);
    expect(value.provenance?.extractedAt).toBe("2026-02-01T00:00:00.000Z");
    const stamped = projectFieldValueFromFact(makeFact(), {
      recordedAt: "2026-07-12T00:00:00.000Z",
      revisionId: "prev_coralina-r2",
    });
    expect(stamped.recordedAt).toBe("2026-07-12T00:00:00.000Z");
    expect(stamped.revisionId).toBe("prev_coralina-r2");
  });
});

describe("value signature", () => {
  it("tells readings apart byte-level, without normalizing", () => {
    expect(projectFieldValueSignature(makeValue())).toBe(projectFieldValueSignature(makeValue()));
    expect(projectFieldValueSignature(makeValue({ rawValue: "THB 4,600,000" }))).not.toBe(
      projectFieldValueSignature(makeValue()),
    );
    expect(projectFieldValueSignature(makeValue({ unit: "sqm" }))).not.toBe(
      projectFieldValueSignature(makeValue()),
    );
    // Confidence and standing do not participate: the signature grades the
    // reading, not its lifecycle.
    expect(projectFieldValueSignature(makeValue({ status: "superseded" }))).toBe(
      projectFieldValueSignature(makeValue()),
    );
  });
});
