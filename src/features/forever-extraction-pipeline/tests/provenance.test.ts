import { describe, expect, it } from "vitest";

import {
  extractionEvidence,
  extractionLocator,
  extractionMethod,
  extractionProvenance,
  extractionProvenanceChain,
  extractionVersion,
  validateExtractionEvidence,
  validateExtractionProvenance,
} from "..";

const SOURCE_ID = "psrc_coralina-price-list-v1-0-0";
const V1 = extractionVersion(1, 0, 0);

describe("extraction evidence", () => {
  it("builds evidence and locators attaching facts only when supplied", () => {
    expect(extractionEvidence(SOURCE_ID)).toEqual({ sourceId: SOURCE_ID });
    const located = extractionEvidence(SOURCE_ID, {
      sourceVersion: V1,
      locator: extractionLocator("sheet", { sheet: "Units", detail: "row 12" }),
      excerpt: "B-1201 | 4,590,000",
    });
    expect(located.locator).toEqual({ kind: "sheet", sheet: "Units", detail: "row 12" });
    expect(Object.keys(extractionLocator("document"))).toEqual(["kind"]);
  });

  it("validates a coherent observation and flags mismatches against the fact", () => {
    const evidence = extractionEvidence(SOURCE_ID, { sourceVersion: V1 });
    expect(
      validateExtractionEvidence(evidence, { sourceId: SOURCE_ID, sourceVersion: V1 }),
    ).toEqual([]);

    const codes = validateExtractionEvidence(evidence, {
      sourceId: "psrc_other",
      sourceVersion: extractionVersion(2, 0, 0),
    }).map((issue) => issue.code);
    expect(codes).toEqual(["evidence_source_mismatch", "evidence_version_mismatch"]);
  });

  it("flags empty sources, unknown locator kinds, and incoherent positions", () => {
    expect(validateExtractionEvidence(extractionEvidence("")).map((issue) => issue.code)).toEqual([
      "missing_evidence_source",
    ]);

    const codes = validateExtractionEvidence({
      sourceId: SOURCE_ID,
      locator: { kind: "paragraph" as never, page: 0, frame: -1, sheet: " ", detail: "" },
      excerpt: " ",
    }).map((issue) => issue.code);
    expect(codes).toEqual([
      "unknown_locator_kind",
      "invalid_locator_page",
      "invalid_locator_frame",
      "empty_locator_sheet",
      "empty_locator_detail",
      "empty_evidence_excerpt",
    ]);
  });
});

describe("extraction provenance", () => {
  const method = extractionMethod("pdf_text");

  it("chains a fact back to source, revision, method, and caller-supplied time", () => {
    const provenance = extractionProvenance(SOURCE_ID, V1, method, "2026-02-01T00:00:00.000Z", {
      recipeId: "forever-extraction",
      stepId: "describe-facts",
    });
    expect(provenance).toEqual({
      sourceId: SOURCE_ID,
      sourceVersion: V1,
      method,
      extractedAt: "2026-02-01T00:00:00.000Z",
      recipeId: "forever-extraction",
      stepId: "describe-facts",
    });
    expect(
      validateExtractionProvenance(provenance, { sourceId: SOURCE_ID, sourceVersion: V1 }),
    ).toEqual([]);
  });

  it("reports the derivation chain in declared order with duplicates removed", () => {
    const provenance = extractionProvenance(SOURCE_ID, V1, method, "2026-02-01T00:00:00.000Z", {
      derivedFrom: ["xfact_a", "xfact_b", "xfact_a"],
    });
    expect(extractionProvenanceChain(provenance)).toEqual(["xfact_a", "xfact_b"]);
    expect(
      extractionProvenanceChain(
        extractionProvenance(SOURCE_ID, V1, method, "2026-02-01T00:00:00.000Z"),
      ),
    ).toEqual([]);
  });

  it("flags a chain that mismatches the fact, derives from itself, or repeats a link", () => {
    const provenance = extractionProvenance(
      "psrc_other",
      extractionVersion(2, 0, 0),
      method,
      "2026-02-01T00:00:00.000Z",
      { derivedFrom: ["xfact_self", "xfact_self", " "] },
    );
    const codes = validateExtractionProvenance(provenance, {
      factId: "xfact_self",
      sourceId: SOURCE_ID,
      sourceVersion: V1,
    }).map((issue) => issue.code);
    expect(codes).toEqual([
      "provenance_source_mismatch",
      "provenance_version_mismatch",
      "self_derived_reference",
      "duplicate_derived_reference",
      "self_derived_reference",
      "empty_derived_reference",
    ]);
  });

  it("flags every missing mandatory link and warns on an unconventional time", () => {
    const codes = validateExtractionProvenance({
      sourceId: "",
      sourceVersion: null as never,
      method: undefined as never,
      extractedAt: "",
    }).map((issue) => issue.code);
    expect(codes).toEqual([
      "missing_provenance_source",
      "missing_provenance_version",
      "missing_extraction_method",
      "missing_extraction_time",
    ]);

    const odd = validateExtractionProvenance(
      extractionProvenance(SOURCE_ID, V1, method, "yesterday"),
    );
    expect(odd).toHaveLength(1);
    expect(odd[0]).toMatchObject({ code: "unconventional_extraction_time", severity: "warning" });
  });
});
