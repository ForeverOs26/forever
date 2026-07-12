import { describe, expect, it } from "vitest";

import {
  CROSS_VALIDATION_DIMENSIONS,
  CROSS_VALIDATION_DISPOSITIONS,
  CROSS_VALIDATION_FINDING_KINDS,
  compareCrossValidationFindings,
  crossValidationDimensionForFactType,
  crossValidationFinding,
  crossValidationFindingKindRank,
  crossValidationFindingRequiresReview,
  isKnownCrossValidationDimension,
  isKnownCrossValidationDisposition,
  isKnownCrossValidationFindingKind,
  sortCrossValidationFindings,
} from "..";

describe("finding vocabularies", () => {
  it("guards recognise exactly the declared vocabulary", () => {
    for (const kind of CROSS_VALIDATION_FINDING_KINDS) {
      expect(isKnownCrossValidationFindingKind(kind)).toBe(true);
    }
    for (const disposition of CROSS_VALIDATION_DISPOSITIONS) {
      expect(isKnownCrossValidationDisposition(disposition)).toBe(true);
    }
    for (const dimension of CROSS_VALIDATION_DIMENSIONS) {
      expect(isKnownCrossValidationDimension(dimension)).toBe(true);
    }
    for (const value of ["", "verdict", 3, null, undefined]) {
      expect(isKnownCrossValidationFindingKind(value)).toBe(false);
      expect(isKnownCrossValidationDisposition(value)).toBe(false);
      expect(isKnownCrossValidationDimension(value)).toBe(false);
    }
  });

  it("ranks kinds by declared order and malformed kinds last", () => {
    expect(crossValidationFindingKindRank("agreement")).toBe(0);
    expect(crossValidationFindingKindRank("missing_information")).toBe(
      CROSS_VALIDATION_FINDING_KINDS.length - 1,
    );
    expect(crossValidationFindingKindRank("nonsense" as never)).toBe(
      CROSS_VALIDATION_FINDING_KINDS.length,
    );
  });

  it("maps fact types to the dimensions their disagreements are about", () => {
    expect(crossValidationDimensionForFactType("price")).toBe("price");
    expect(crossValidationDimensionForFactType("price_per_sqm")).toBe("price");
    expect(crossValidationDimensionForFactType("currency")).toBe("currency");
    expect(crossValidationDimensionForFactType("internal_area")).toBe("area");
    expect(crossValidationDimensionForFactType("land_area")).toBe("area");
    expect(crossValidationDimensionForFactType("completion_date")).toBe("date");
    expect(crossValidationDimensionForFactType("document_date")).toBe("date");
    expect(crossValidationDimensionForFactType("project_name")).toBe("identity");
    expect(crossValidationDimensionForFactType("developer")).toBe("identity");
    expect(crossValidationDimensionForFactType("amenity")).toBe("value");
    expect(crossValidationDimensionForFactType("unknown")).toBe("value");
  });
});

describe("crossValidationFinding", () => {
  it("attaches optional facts only when supplied", () => {
    const bare = crossValidationFinding("xfnd_1", "conflict", "requires_review", "proj_x", "msg");
    expect(bare).toEqual({
      id: "xfnd_1",
      kind: "conflict",
      disposition: "requires_review",
      projectId: "proj_x",
      message: "msg",
      references: [],
    });
    const full = crossValidationFinding("xfnd_2", "agreement", "informational", "proj_x", "msg", {
      subjectKey: "proj_x:price",
      path: "pricing.basePrice",
      dimension: "price",
      independentSources: true,
      references: [{ factId: "xfact_a" }],
      detectedAt: "2026-07-12T00:00:00.000Z",
    });
    expect(full.subjectKey).toBe("proj_x:price");
    expect(full.independentSources).toBe(true);
    expect(full.detectedAt).toBe("2026-07-12T00:00:00.000Z");
  });

  it("never aliases caller input", () => {
    const references = [{ factId: "xfact_a" }];
    const finding = crossValidationFinding("xfnd_1", "conflict", "requires_review", "p", "m", {
      references,
    });
    expect(finding.references).not.toBe(references);
    finding.references.push({ factId: "xfact_b" });
    expect(references).toHaveLength(1);
  });

  it("knows which findings require review", () => {
    expect(
      crossValidationFindingRequiresReview(
        crossValidationFinding("x", "conflict", "requires_review", "p", "m"),
      ),
    ).toBe(true);
    expect(
      crossValidationFindingRequiresReview(
        crossValidationFinding("x", "agreement", "informational", "p", "m"),
      ),
    ).toBe(false);
    expect(crossValidationFindingRequiresReview(null as never)).toBe(false);
  });
});

describe("finding ordering", () => {
  it("orders by kind rank, subject, path, first fact, then id — stably and immutably", () => {
    const make = (
      kind: "agreement" | "conflict",
      subjectKey: string | undefined,
      factId: string,
      id: string,
    ) =>
      crossValidationFinding(id, kind, "informational", "p", "m", {
        subjectKey,
        references: [{ factId }],
      });
    const findings = [
      make("conflict", "b", "f1", "x4"),
      make("agreement", "b", "f1", "x3"),
      make("agreement", "a", "f2", "x2"),
      make("agreement", "a", "f1", "x1"),
      make("agreement", undefined, "f0", "x5"),
    ];
    const snapshot = structuredClone(findings);
    const sorted = sortCrossValidationFindings(findings);
    expect(sorted.map((finding) => finding.id)).toEqual(["x1", "x2", "x3", "x5", "x4"]);
    expect(findings).toEqual(snapshot);
    expect(compareCrossValidationFindings(findings[0], findings[0])).toBe(0);
  });
});
