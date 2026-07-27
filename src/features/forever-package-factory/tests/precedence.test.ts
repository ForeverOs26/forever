/**
 * Source precedence and availability reconciliation: newer wins, byte-identical
 * reposts change nothing, and absence is never read as SOLD.
 */

import { describe, expect, it } from "vitest";

import {
  compareSourceRecency,
  normalizeStatus,
  reconcileAvailability,
  resolveStatementUnitCodes,
  resolveUnitCodeAlias,
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

describe("unit-code aliases", () => {
  // The real inventory shape: a project prefix plus tower, floor and index.
  const known = new Set(["MBD620", "MBE703", "MBF611", "MBG710", "MBA101"]);

  it("resolves a short SOLD code to the schedule's full unit code", () => {
    expect(resolveUnitCodeAlias("D620", known)).toBe("MBD620");
    expect(resolveUnitCodeAlias("G710", known)).toBe("MBG710");
  });

  it("prefers an exact match over any suffix match", () => {
    expect(resolveUnitCodeAlias("MBA101", known)).toBe("MBA101");
  });

  it("refuses to guess when two units share the suffix", () => {
    const ambiguous = new Set(["MBD620", "XD620"]);
    expect(resolveUnitCodeAlias("D620", ambiguous)).toBeNull();
  });

  it("refuses a suffix whose stripped prefix is not a project prefix", () => {
    // "620" would strip "MBD" — letters — but is only 3 chars of digits and
    // would match far too eagerly, so require the remainder to be letters only.
    expect(resolveUnitCodeAlias("620", new Set(["MBD620"]))).toBe("MBD620");
    // A numeric remainder is never a project prefix.
    expect(resolveUnitCodeAlias("B620", new Set(["12B620"]))).toBeNull();
  });

  it("refuses a code too short to be distinctive", () => {
    expect(resolveUnitCodeAlias("20", known)).toBeNull();
  });

  it("returns null when nothing in the inventory matches", () => {
    expect(resolveUnitCodeAlias("Z999", known)).toBeNull();
  });

  it("splits statements into resolved and unresolved without inventing units", () => {
    const statement = (unitCode: string): AvailabilityStatement => ({
      unitCode,
      status: "SOLD",
      effectiveDate: "2026-07-23",
      sourceRef: "note.txt",
      sha256: "9".repeat(64),
    });
    const { resolved, unresolved } = resolveStatementUnitCodes(
      [statement("D620"), statement("Z999")],
      known,
    );
    expect(resolved.map((s) => s.unitCode)).toEqual(["MBD620"]);
    expect(unresolved.map((s) => s.unitCode)).toEqual(["Z999"]);
  });

  it("makes a short SOLD note override the schedule's row for the same home", () => {
    const schedule: AvailabilityStatement = {
      unitCode: "MBD620",
      status: "Available",
      effectiveDate: "2026-07-17",
      sourceRef: "price-list.pdf",
      sha256: "1".repeat(64),
    };
    const shortSold: AvailabilityStatement = {
      unitCode: "D620",
      status: "SOLD",
      effectiveDate: "2026-07-23",
      sourceRef: "note.txt",
      sha256: "2".repeat(64),
    };
    const { resolved } = resolveStatementUnitCodes([schedule, shortSold], known);
    const results = reconcileAvailability(resolved);
    // One home, not two.
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ unitCode: "MBD620", status: "sold" });
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
