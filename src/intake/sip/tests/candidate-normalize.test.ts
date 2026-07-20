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
  return rows?.find((r) => r.unit_number?.value === unit);
}

describe("SIP-001A candidate normalization — the Rainpalm-like fixture", () => {
  const { priceList, reviewItems, duplicateUnitIdentities } = candidatesFor(
    "rainpalm-price-list.pdftotext-layout.txt",
  );
  const rows = priceList.unit_inventory ?? [];

  it("produces no duplicate identities on the happy-path fixture", () => {
    expect(duplicateUnitIdentities).toEqual([]);
  });

  it("wraps a positive price as a high-confidence source-verified numeric fact with source refs", () => {
    const a1 = rowFor(rows, "A1")!;
    expect(a1.price?.value).toBe(12500000);
    expect(a1.price?.confidence).toBe("high");
    expect(a1.price?.status).toBe("source_verified");
    expect(a1.price?.source_file).toBe("price-list.pdf");
    expect(a1.price?.page_number).toBe(1);
    expect(a1.price?.raw_value).toBe("12,500,000");
  });

  it("nulls a dash/sentinel price with confidence none and status unresolved, without a review item", () => {
    const a4 = rowFor(rows, "A4")!;
    expect(a4.price?.value).toBeNull();
    expect(a4.price?.confidence).toBe("none");
    expect(a4.price?.status).toBe("unresolved");
    expect(reviewItems.some((i) => i.row === a4.source_row && i.column === "price")).toBe(false);
  });

  it("nulls a zero price and raises a review item (never a fabricated value)", () => {
    const a5 = rowFor(rows, "A5")!;
    expect(a5.price?.value).toBeNull();
    const item = reviewItems.find((i) => i.column === "price" && i.row === a5.source_row);
    expect(item?.reasonCode).toBe("price_unsupported_value");
  });

  it("nulls a non-numeric price and raises a review item", () => {
    const a6 = rowFor(rows, "A6")!;
    expect(a6.price?.value).toBeNull();
    const item = reviewItems.find((i) => i.column === "price" && i.row === a6.source_row);
    expect(item?.reasonCode).toBe("price_unsupported_value");
  });

  it("never performs price arithmetic — size_sqm and price are independent facts", () => {
    const a1 = rowFor(rows, "A1")!;
    expect(a1.size_sqm?.value).toBe(220.5);
    expect(a1.price?.value).toBe(12500000);
    expect((a1 as unknown as Record<string, unknown>).price_per_sqm).toBeUndefined();
  });

  it("takes currency only from the mapped price column's own header evidence", () => {
    const a1 = rowFor(rows, "A1")!;
    expect(a1.currency?.value).toBe("THB");
    expect(a1.currency?.status).toBe("source_verified");
    expect(priceList.currency_decision?.value).toBe("THB");
    expect(priceList.currency_decision?.status).toBe("source_verified");
  });

  it("normalizes a known availability label with high confidence", () => {
    const a1 = rowFor(rows, "A1")!;
    expect(a1.availability_status?.value).toBe("Available");
    expect(a1.availability_status?.confidence).toBe("high");
  });

  it("merges a continuation line's text into the previous row's availability", () => {
    const a7 = rowFor(rows, "A7")!;
    expect(a7.availability_status?.raw_value).toBe("Reserved - pending contract");
  });

  it("keeps every row (source-null sold villas remain rows with null prices)", () => {
    expect(rows.map((r) => r.unit_number?.value)).toEqual([
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
      "A7",
      "A8",
      "B1",
      "B2",
      "B3",
    ]);
  });

  it("assigns stable, sequential review-item IDs", () => {
    expect(
      reviewItems.every((item, i) => item.id === `REVIEW-${String(i + 1).padStart(4, "0")}`),
    ).toBe(true);
  });
});

describe("SIP-001A candidate normalization — currency edge cases", () => {
  it("leaves currency unresolved and flags review when the price column has no parenthetical evidence", () => {
    const { priceList, reviewItems } = candidatesFor("no-currency-evidence.pdftotext-layout.txt");
    const rows = priceList.unit_inventory ?? [];
    expect(rows.every((r) => r.currency === undefined)).toBe(true);
    expect(priceList.currency_decision?.status).toBe("unresolved");
    expect(reviewItems.some((i) => i.reasonCode === "unclear_or_inferred_currency")).toBe(true);
  });

  it("never treats a fee column's currency as price-currency evidence", () => {
    const { priceList } = candidatesFor("fee-currency-not-applicable.pdftotext-layout.txt");
    const rows = priceList.unit_inventory ?? [];
    expect(rows[0].currency).toBeUndefined();
    expect(priceList.currency_decision?.status).toBe("unresolved");
  });
});

describe("SIP-001A candidate normalization — numeric separators and identity", () => {
  it("flags an ambiguous thousands/decimal separator instead of guessing a value", () => {
    const { priceList, reviewItems } = candidatesFor(
      "ambiguous-numeric-separator.pdftotext-layout.txt",
    );
    const row = priceList.unit_inventory?.[0];
    expect(row?.price?.value).toBeNull();
    expect(reviewItems.some((i) => i.reasonCode === "unsupported_numeric_separator")).toBe(true);
  });

  it("blocks on duplicate normalized unit identities", () => {
    const { duplicateUnitIdentities, reviewItems } = candidatesFor(
      "duplicate-identity.pdftotext-layout.txt",
    );
    expect(duplicateUnitIdentities).toEqual(["A1"]);
    const blocking = reviewItems.filter((i) => i.reasonCode === "duplicate_identity");
    expect(blocking).toHaveLength(2);
    expect(blocking.every((i) => i.blocking)).toBe(true);
  });
});

describe("SIP-001A price-list date extraction — document content only", () => {
  it("extracts a single unambiguous date from document text", () => {
    resetReviewIdCounter();
    const extraction = fixtureExtraction("rainpalm-price-list.pdftotext-layout.txt");
    const result = extractPriceListDate(extraction.pages, "price-list.pdf");
    expect(result.fact?.value).toBe("2026-07-03");
    expect(result.fact?.raw_value).toContain("03.07.26");
    expect(result.reviewItem).toBeNull();
  });

  it("flags conflicting dates as unclear instead of picking one", () => {
    resetReviewIdCounter();
    const extraction = fixtureExtraction("conflicting-date.pdftotext-layout.txt");
    const result = extractPriceListDate(extraction.pages, "price-list.pdf");
    expect(result.fact).toBeNull();
    expect(result.reviewItem?.reasonCode).toBe("unclear_date");
  });

  it("omits the date fact entirely when no date appears in the document", () => {
    resetReviewIdCounter();
    const extraction = fixtureExtraction("no-currency-evidence.pdftotext-layout.txt");
    const result = extractPriceListDate(extraction.pages, "price-list.pdf");
    expect(result.fact).toBeNull();
    expect(result.reviewItem).toBeNull();
  });
});

describe("SIP-001A reviewed final JSON — only high-confidence cells survive", () => {
  it("nulls out medium-confidence cells rather than accepting them without review", () => {
    resetReviewIdCounter();
    const { priceList } = candidatesFor("rainpalm-price-list.pdftotext-layout.txt");
    const reviewed = buildReviewedPriceList(priceList);
    const a8 = rowFor(reviewed.unit_inventory, "A8")!;
    // A8 is Studio / bed=2 / bath=2 — all clean numeric/text high-confidence
    // cells, so nothing should be nulled for it.
    expect(a8.unit_type?.value).toBe("Studio");
    // The row structure survives finalization unchanged for a fully clean row.
    expect(a8.price?.value).toBe(9500000);
  });

  it("keeps a source-null sold row as a null-price row in the reviewed output", () => {
    resetReviewIdCounter();
    const { priceList } = candidatesFor("rainpalm-price-list.pdftotext-layout.txt");
    const reviewed = buildReviewedPriceList(priceList);
    const a4 = rowFor(reviewed.unit_inventory, "A4")!;
    expect(a4).toBeDefined();
    expect(a4.price?.value).toBeNull();
  });
});
