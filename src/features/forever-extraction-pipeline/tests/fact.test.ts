import { describe, expect, it } from "vitest";

import {
  describeExtractionFact,
  extractionFactSubjectKey,
  extractionVersion,
  validateExtractionFact,
} from "..";
import { makeFactInput } from "./fixtures";

describe("describeExtractionFact", () => {
  it("describes every field the fact model must carry, and validates cleanly", () => {
    const fact = describeExtractionFact(makeFactInput());
    expect(fact).toMatchObject({
      id: "xfact_coralina-price-1br-v1-0-0",
      projectId: "proj_coralina",
      sourceId: "psrc_coralina-price-list-v1-0-0",
      sourceVersion: { major: 1, minor: 0, patch: 0 },
      factType: "price",
      fieldPath: "pricing.basePrice",
      valueKind: "structured",
      rawValue: "THB 4,590,000",
      structuredValue: { amount: 4590000, currency: "THB" },
      language: "en",
      confidence: { level: "high", score: 0.9 },
      status: "extracted",
      reviewStatus: "unreviewed",
      validationStatus: "unvalidated",
    });
    expect(fact.evidence).toEqual({
      sourceId: "psrc_coralina-price-list-v1-0-0",
      sourceVersion: { major: 1, minor: 0, patch: 0 },
      locator: { kind: "page", page: 3, detail: "price table, row 1BR" },
      excerpt: "1BR — THB 4,590,000",
    });
    expect(fact.provenance).toEqual({
      sourceId: "psrc_coralina-price-list-v1-0-0",
      sourceVersion: { major: 1, minor: 0, patch: 0 },
      method: { kind: "manual", description: "Read off the printed price table." },
      extractedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(validateExtractionFact(fact)).toEqual([]);
  });

  it("keeps missing observations explicitly absent — no key, no placeholder", () => {
    const fact = describeExtractionFact(
      makeFactInput({
        rawValue: "Sea view",
        structuredValue: undefined,
        unit: undefined,
        language: undefined,
        confidence: undefined,
        locator: undefined,
        excerpt: undefined,
        fieldPath: undefined,
      }),
    );
    const keys = Object.keys(fact);
    expect(keys).not.toContain("structuredValue");
    expect(keys).not.toContain("unit");
    expect(keys).not.toContain("language");
    expect(keys).not.toContain("fieldPath");
    expect(Object.keys(fact.evidence)).not.toContain("locator");
    expect(Object.keys(fact.evidence)).not.toContain("excerpt");
    expect(JSON.stringify(fact)).not.toContain("null");
  });

  it("keeps unknown confidence unknown — never a fabricated grade or score", () => {
    const fact = describeExtractionFact(makeFactInput({ confidence: undefined }));
    expect(fact.confidence).toEqual({ level: "unknown" });
    expect(Object.keys(fact.confidence)).not.toContain("score");
  });

  it("defaults the value kind honestly: structured when structured, raw otherwise, derived only when declared", () => {
    expect(describeExtractionFact(makeFactInput()).valueKind).toBe("structured");
    expect(describeExtractionFact(makeFactInput({ structuredValue: undefined })).valueKind).toBe(
      "raw",
    );
    const derived = describeExtractionFact(
      makeFactInput({
        factSlug: "price-per-sqm-1br",
        factType: "price_per_sqm",
        valueKind: "derived",
        derivedFrom: ["xfact_coralina-price-1br-v1-0-0", "xfact_coralina-area-1br-v1-0-0"],
      }),
    );
    expect(derived.valueKind).toBe("derived");
    expect(derived.provenance.derivedFrom).toEqual([
      "xfact_coralina-price-1br-v1-0-0",
      "xfact_coralina-area-1br-v1-0-0",
    ]);
  });

  it("represents an unavailable fact with no value at all", () => {
    const missing = describeExtractionFact(
      makeFactInput({
        factSlug: "land-area",
        factType: "land_area",
        status: "unavailable",
        rawValue: undefined,
        structuredValue: undefined,
        valueKind: "raw",
      }),
    );
    expect(missing.status).toBe("unavailable");
    expect(Object.keys(missing)).not.toContain("rawValue");
    expect(Object.keys(missing)).not.toContain("structuredValue");
    expect(validateExtractionFact(missing)).toEqual([]);
  });

  it("addresses repeated attempts by revision: a v2 re-extraction never collides with v1", () => {
    const v1 = describeExtractionFact(makeFactInput());
    const v2 = describeExtractionFact(
      makeFactInput({
        sourceVersion: extractionVersion(2, 0, 0),
        sourceId: "psrc_coralina-price-list-v2-0-0",
      }),
    );
    expect(v1.id).not.toBe(v2.id);
    expect(v2.id).toBe("xfact_coralina-price-1br-v2-0-0");
    expect(extractionFactSubjectKey(v1)).toBe(extractionFactSubjectKey(v2));
  });

  it("carries supersession and conflict references only when declared", () => {
    const superseded = describeExtractionFact(
      makeFactInput({ status: "superseded", supersededBy: "xfact_coralina-price-1br-v2-0-0" }),
    );
    expect(superseded.supersededBy).toBe("xfact_coralina-price-1br-v2-0-0");
    expect(Object.keys(describeExtractionFact(makeFactInput()))).not.toContain("supersededBy");
    expect(Object.keys(describeExtractionFact(makeFactInput()))).not.toContain("conflictsWith");
  });

  it("computes the subject key from project, fact type, and field path", () => {
    expect(extractionFactSubjectKey(describeExtractionFact(makeFactInput()))).toBe(
      "proj_coralina:price:pricing.basePrice",
    );
    expect(
      extractionFactSubjectKey(describeExtractionFact(makeFactInput({ fieldPath: undefined }))),
    ).toBe("proj_coralina:price");
  });
});
