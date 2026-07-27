/**
 * Source precedence and availability reconciliation: newer wins, byte-identical
 * reposts change nothing, and absence is never read as SOLD.
 */

import { describe, expect, it } from "vitest";

import {
  compareSourceRecency,
  normalizeStatus,
  reconcileAvailability,
  revisionRank,
  selectCurrentSource,
  type AvailabilityStatement,
  type DatedSource,
} from "../precedence";

function source(overrides: Partial<DatedSource>): DatedSource {
  return {
    ref: "doc.pdf",
    sha256: "a".repeat(64),
    effectiveDate: null,
    revision: null,
    publishedAt: null,
    ...overrides,
  };
}

describe("precedence order", () => {
  it("prefers the explicit in-document effective date above everything else", () => {
    const older = source({
      effectiveDate: "2026-07-03",
      revision: "V9",
      publishedAt: "2026-07-30",
    });
    const newer = source({
      effectiveDate: "2026-07-17",
      revision: "V1",
      publishedAt: "2026-07-01",
    });
    expect(compareSourceRecency(newer, older)).toBeGreaterThan(0);
  });

  it("falls back to the official revision when effective dates tie", () => {
    const v1 = source({ effectiveDate: "2026-07-17", revision: "V1" });
    const v2 = source({ effectiveDate: "2026-07-17", revision: "V2" });
    expect(compareSourceRecency(v2, v1)).toBeGreaterThan(0);
    expect(revisionRank("V2")).toBe(2);
    expect(revisionRank(null)).toBe(-1);
  });

  it("falls back to the publication date, then to the fingerprint", () => {
    const early = source({ publishedAt: "2026-07-01" });
    const late = source({ publishedAt: "2026-07-20" });
    expect(compareSourceRecency(late, early)).toBeGreaterThan(0);

    const a = source({ sha256: "a".repeat(64) });
    const b = source({ sha256: "b".repeat(64) });
    expect(compareSourceRecency(b, a)).toBeGreaterThan(0);
    // Deterministic: the same comparison always yields the same winner.
    expect(compareSourceRecency(a, b)).toBeLessThan(0);
  });

  it("selects the current source from a mixed list", () => {
    const current = selectCurrentSource([
      source({ ref: "old.pdf", effectiveDate: "2026-06-26" }),
      source({ ref: "new.pdf", effectiveDate: "2026-07-17" }),
      source({ ref: "older.pdf", effectiveDate: "2026-05-22" }),
    ]);
    expect(current?.ref).toBe("new.pdf");
  });
});

describe("availability reconciliation", () => {
  const priceList: AvailabilityStatement = {
    unitCode: "D620",
    status: "Available",
    effectiveDate: "2026-07-17",
    sourceRef: "price-list.pdf",
    sha256: "1".repeat(64),
  };

  it("lets a newer SOLD announcement override an older price list", () => {
    const sold: AvailabilityStatement = {
      unitCode: "D620",
      status: "SOLD",
      effectiveDate: "2026-07-23",
      sourceRef: "sold-note.txt",
      sha256: "2".repeat(64),
    };
    const [result] = reconcileAvailability([priceList, sold]);
    expect(result.status).toBe("sold");
    expect(result.sourceRef).toBe("sold-note.txt");
    expect(result.supersededBy).toEqual(["price-list.pdf"]);
  });

  it("lets a NEWER price list re-list a previously SOLD unit as available", () => {
    const sold: AvailabilityStatement = {
      unitCode: "D620",
      status: "SOLD",
      effectiveDate: "2026-07-01",
      sourceRef: "sold-note.txt",
      sha256: "2".repeat(64),
    };
    const [result] = reconcileAvailability([sold, priceList]);
    expect(result.status).toBe("available");
    expect(result.sourceRef).toBe("price-list.pdf");
  });

  it("treats a byte-identical repost as the same statement, not a newer one", () => {
    const repost: AvailabilityStatement = { ...priceList, sourceRef: "price-list-repost.pdf" };
    const results = reconcileAvailability([priceList, repost]);
    expect(results).toHaveLength(1);
    expect(results[0].supersededBy).toEqual([]);
  });

  it("never invents a status for a unit no source mentions", () => {
    const results = reconcileAvailability([priceList]);
    expect(results.map((entry) => entry.unitCode)).toEqual(["D620"]);
  });

  it("normalizes the status vocabulary developers actually use", () => {
    expect(normalizeStatus("Available")).toBe("available");
    expect(normalizeStatus(" SOLD ")).toBe("sold");
    expect(normalizeStatus("Booked")).toBe("reserved");
  });
});
