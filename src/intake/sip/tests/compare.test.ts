import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExtractedPriceList, Fact } from "@/import/types";

import { compareAgainstGroundTruth, readExtractedPriceListFile } from "../compare";

function fact<T>(value: T | null, extra: Partial<Fact<T>> = {}): Fact<T> {
  return {
    value,
    source_file: "x.pdf",
    page_number: 1,
    confidence: value == null ? "none" : "high",
    status: value == null ? "unresolved" : "source_verified",
    ...extra,
  };
}

function priceList(rows: ExtractedPriceList["unit_inventory"]): ExtractedPriceList {
  return { unit_inventory: rows };
}

describe("SIP-001A ground-truth comparison — read-only, explicit numerators/denominators", () => {
  const groundTruth = priceList([
    {
      unit_number: fact("A1"),
      unit_type: fact("Type A"),
      bedrooms: fact(3),
      price: fact(12500000),
      currency: fact("THB"),
    },
    { unit_number: fact("A4"), price: fact<string | number>(null) }, // sold, source-null
    { unit_number: fact("A9"), price: fact(9000000) }, // will be missing from extraction
  ]);

  it("computes recall, agreement, null-preservation, and fabrication counts against a synthetic ground truth", () => {
    const reviewed = priceList([
      {
        unit_number: fact("A1"),
        unit_type: fact("Type A"),
        bedrooms: fact(3),
        price: fact(12500000),
        currency: fact("THB"),
      },
      { unit_number: fact("A4"), price: fact<string | number>(null) },
      { unit_number: fact("A99"), price: fact(1) }, // unexpected row not in ground truth
    ]);

    const report = compareAgainstGroundTruth(reviewed, groundTruth, { reviewItemCount: 2 });

    expect(report.extracted_unit_row_recall).toEqual({ numerator: 2, denominator: 3 });
    expect(report.exact_unit_identity_agreement).toEqual({ numerator: 2, denominator: 3 });
    expect(report.positive_price_agreement).toEqual({ numerator: 1, denominator: 1 });
    expect(report.null_price_preservation).toEqual({ numerator: 1, denominator: 1 });
    expect(report.missing_expected_row_count).toBe(1); // A9 never found
    expect(report.unexpected_row_count).toBe(1); // A99
    expect(report.fabricated_price_count).toBe(0);
    expect(report.lost_null_price_count).toBe(0);
    expect(report.review_item_count).toBe(2);
  });

  it("compares formatted prices and equivalent compact unit-type labels", () => {
    const reviewed = priceList([
      { unit_number: fact("A1"), unit_type: fact("A"), price: fact(12500000) },
    ]);
    const formattedGroundTruth = priceList([
      {
        unit_number: fact("A1"),
        unit_type: fact("Pool Villa Type A"),
        price: fact("12,500,000"),
      },
    ]);
    const report = compareAgainstGroundTruth(reviewed, formattedGroundTruth);
    expect(report.exact_unit_type_agreement).toEqual({ numerator: 1, denominator: 1 });
    expect(report.positive_price_agreement).toEqual({ numerator: 1, denominator: 1 });
  });

  it("counts a fabricated price when a ground-truth null-price unit gets a positive extracted price", () => {
    const reviewed = priceList([{ unit_number: fact("A4"), price: fact(5000000) }]);
    const report = compareAgainstGroundTruth(reviewed, groundTruth);
    expect(report.fabricated_price_count).toBe(1);
    expect(report.lost_null_price_count).toBe(1);
  });

  it("reports a missing null-price row separately without calling the absent value fabricated", () => {
    const reviewed = priceList([{ unit_number: fact("A1"), price: fact(12500000) }]);
    const report = compareAgainstGroundTruth(reviewed, groundTruth);
    expect(report.lost_null_price_count).toBe(0);
    expect(report.missing_expected_row_count).toBe(2);
  });

  it("requires source references even for an explicit null-price fact", () => {
    const reviewed = priceList([
      {
        unit_number: fact("A4"),
        price: fact<string | number>(null, { source_file: null, page_number: null }),
      },
    ]);
    const report = compareAgainstGroundTruth(reviewed, groundTruth);
    expect(report.source_reference_completeness).toEqual({ numerator: 1, denominator: 2 });
  });

  it("never mutates the reviewed or ground-truth input objects", () => {
    const reviewed = priceList([{ unit_number: fact("A1"), price: fact(12500000) }]);
    const reviewedCopy = JSON.parse(JSON.stringify(reviewed));
    const gtCopy = JSON.parse(JSON.stringify(groundTruth));
    compareAgainstGroundTruth(reviewed, groundTruth);
    expect(reviewed).toEqual(reviewedCopy);
    expect(groundTruth).toEqual(gtCopy);
  });
});

describe("SIP-001A ground-truth comparison — file reading is explicit and isolated", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sip-compare-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads an ExtractedPriceList-shaped file given an explicit path", () => {
    const path = join(dir, "ground-truth.json");
    writeFileSync(path, JSON.stringify({ unit_inventory: [] }), "utf8");
    const parsed = readExtractedPriceListFile(path);
    expect(parsed.unit_inventory).toEqual([]);
  });

  it("fails closed on a file that is not ExtractedPriceList-shaped", () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify({ not_a_price_list: true }), "utf8");
    expect(() => readExtractedPriceListFile(path)).toThrow(/sip_compare_input_unreadable/);
  });
});
