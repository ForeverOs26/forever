import { describe, expect, it } from "vitest";

import {
  buildPriceListCandidates,
  buildReviewedPriceList,
  extractPriceListDate,
  resetReviewIdCounter,
} from "../candidate-normalize";
import { extractDocumentTables } from "../price-table";
import { fixtureExtraction } from "./test-support";

function candidatesFor(fixture: string, sourceFile = "price-list.pdf") {
  resetReviewIdCounter();
  const extraction = fixtureExtraction(fixture);
  const { regions } = extractDocumentTables(extraction.pages);
  return { ...buildPriceListCandidates(regions, sourceFile), extraction };
}

function rowFor(
  rows: ReturnType<typeof candidatesFor>["priceList"]["unit_inventory"],
  unit: string,
) {
  return rows?.find((row) => row.unit_number?.value === unit);
}

describe("SIP-001A candidate normalization - independent generic fixture", () => {
  const { priceList, reviewItems, duplicateUnitIdentities } = candidatesFor(
    "generic-price-list.pdftotext-layout.txt",
  );
  const rows = priceList.unit_inventory ?? [];

  it("produces no duplicate identities", () => {
    expect(duplicateUnitIdentities).toEqual([]);
  });

  it("wraps a positive price as a source-verified numeric fact with exact refs", () => {
    const row = rowFor(rows, "X101")!;
    expect(row.price).toMatchObject({
      value: 18750000,
      raw_value: "18,750,000",
      confidence: "high",
      status: "source_verified",
      source_file: "price-list.pdf",
      page_number: 1,
    });
  });

  it("preserves a source-null sold row without creating a review item for the dash", () => {
    const row = rowFor(rows, "X102")!;
    expect(row.price).toMatchObject({ value: null, confidence: "none", status: "unresolved" });
    expect(reviewItems.some((item) => item.row === row.source_row && item.column === "price")).toBe(
      false,
    );
  });

  it("nulls zero and non-numeric prices and creates review items", () => {
    for (const unit of ["X103", "X104"]) {
      const row = rowFor(rows, unit)!;
      expect(row.price?.value).toBeNull();
      expect(
        reviewItems.some(
          (item) => item.row === row.source_row && item.reasonCode === "price_unsupported_value",
        ),
      ).toBe(true);
    }
  });

  it("never calculates price-per-sqm", () => {
    const row = rowFor(rows, "X101")!;
    expect(row.size_sqm?.value).toBe(201.5);
    expect(row.price?.value).toBe(18750000);
    expect((row as unknown as Record<string, unknown>).price_per_sqm).toBeUndefined();
  });

  it("uses source THB when the selling-price header states THB", () => {
    const row = rowFor(rows, "X101")!;
    expect(row.currency?.value).toBe("THB");
    expect(row.currency?.status).toBe("source_verified");
    expect(priceList.currency_decision).toMatchObject({ value: "THB", status: "source_verified" });
  });

  it("normalizes mapped availability and reviews unmapped continuation text", () => {
    expect(rowFor(rows, "X101")?.availability_status?.value).toBe("Available");
    expect(rowFor(rows, "X105")?.availability_status?.raw_value).toBe(
      "Reserved - pending contract",
    );
    expect(reviewItems.some((item) => item.reasonCode === "medium_confidence_cell")).toBe(true);
  });

  it("keeps every source row in source order", () => {
    expect(rows.map((row) => row.unit_number?.value)).toEqual([
      "X101",
      "X102",
      "X103",
      "X104",
      "X105",
      "Y201",
      "Y202",
      "Y203",
    ]);
  });

  it("assigns stable sequential review IDs", () => {
    expect(
      reviewItems.every(
        (item, index) => item.id === `REVIEW-${String(index + 1).padStart(4, "0")}`,
      ),
    ).toBe(true);
  });
});

describe("SIP-001A Owner-approved THB scope", () => {
  it("uses inferred_default THB when the selling-price header has no currency", () => {
    const { priceList, reviewItems } = candidatesFor("no-currency-evidence.pdftotext-layout.txt");
    expect(
      priceList.unit_inventory?.every(
        (row) => row.currency?.value === "THB" && row.currency.status === "inferred_default",
      ),
    ).toBe(true);
    expect(priceList.currency_decision).toMatchObject({ value: "THB", status: "inferred_default" });
    expect(reviewItems.some((item) => item.reasonCode === "unclear_or_inferred_currency")).toBe(
      false,
    );
  });

  it("does not treat a THB fee column as selling-price source evidence", () => {
    const { priceList } = candidatesFor("fee-currency-not-applicable.pdftotext-layout.txt");
    expect(priceList.unit_inventory?.[0].currency).toMatchObject({
      value: "THB",
      status: "inferred_default",
    });
    expect(priceList.currency_decision).toMatchObject({ value: "THB", status: "inferred_default" });
  });
});

describe("SIP-001A numeric separators and identity", () => {
  it("flags an ambiguous thousands/decimal separator", () => {
    const { priceList, reviewItems } = candidatesFor(
      "ambiguous-numeric-separator.pdftotext-layout.txt",
    );
    expect(priceList.unit_inventory?.[0].price?.value).toBeNull();
    expect(reviewItems.some((item) => item.reasonCode === "unsupported_numeric_separator")).toBe(
      true,
    );
  });

  it("blocks duplicate normalized unit identities", () => {
    const { duplicateUnitIdentities, reviewItems } = candidatesFor(
      "duplicate-identity.pdftotext-layout.txt",
    );
    expect(duplicateUnitIdentities).toEqual(["A1"]);
    const blocking = reviewItems.filter((item) => item.reasonCode === "duplicate_identity");
    expect(blocking).toHaveLength(2);
    expect(blocking.every((item) => item.blocking)).toBe(true);
  });
});

describe("SIP-001A date extraction - document content only", () => {
  it("extracts one unambiguous content date", () => {
    resetReviewIdCounter();
    const extraction = fixtureExtraction("generic-price-list.pdftotext-layout.txt");
    const result = extractPriceListDate(extraction.pages, "price-list.pdf");
    expect(result.fact?.value).toBe("2026-07-03");
    expect(result.fact?.raw_value).toContain("03.07.26");
    expect(result.reviewItem).toBeNull();
  });

  it("flags conflicting dates", () => {
    resetReviewIdCounter();
    const result = extractPriceListDate(
      fixtureExtraction("conflicting-date.pdftotext-layout.txt").pages,
      "price-list.pdf",
    );
    expect(result.fact).toBeNull();
    expect(result.reviewItem?.reasonCode).toBe("unclear_date");
  });

  it("omits a date when document content has none", () => {
    resetReviewIdCounter();
    const result = extractPriceListDate(
      fixtureExtraction("no-currency-evidence.pdftotext-layout.txt").pages,
      "price-list.pdf",
    );
    expect(result.fact).toBeNull();
    expect(result.reviewItem).toBeNull();
  });

  it("rejects impossible calendar dates", () => {
    resetReviewIdCounter();
    const pages = [{ pageNumber: 1, text: "Effective: 31.02.2026", nonWhitespaceCharCount: 20 }];
    const result = extractPriceListDate(pages, "price-list.pdf");
    expect(result.fact).toBeNull();
    expect(result.reviewItem?.reasonCode).toBe("unclear_date");
  });
});

describe("SIP-001A finalized deterministic JSON", () => {
  it("omits medium-confidence values while retaining clean rows", () => {
    const { priceList } = candidatesFor("generic-price-list.pdftotext-layout.txt");
    const finalized = buildReviewedPriceList(priceList);
    const clean = rowFor(finalized.unit_inventory, "Y202")!;
    expect(clean.unit_type?.value).toBe("Pavilion");
    expect(clean.price?.value).toBe(24100000);
    expect(rowFor(finalized.unit_inventory, "X105")?.availability_status?.value).toBeNull();
  });

  it("keeps a source-null sold row", () => {
    const { priceList } = candidatesFor("generic-price-list.pdftotext-layout.txt");
    const finalized = buildReviewedPriceList(priceList);
    expect(rowFor(finalized.unit_inventory, "X102")?.price?.value).toBeNull();
  });

  it("retains the Owner-approved inferred-default THB fact", () => {
    const { priceList } = candidatesFor("no-currency-evidence.pdftotext-layout.txt");
    const finalized = buildReviewedPriceList(priceList);
    expect(finalized.unit_inventory?.[0].currency).toMatchObject({
      value: "THB",
      status: "inferred_default",
      confidence: "medium",
    });
  });
});
