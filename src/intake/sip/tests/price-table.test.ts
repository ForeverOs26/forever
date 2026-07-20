import { describe, expect, it } from "vitest";

import { extractDocumentTables, isSyntacticUnitIdentity, splitColumns } from "../price-table";
import { fixtureExtraction } from "./test-support";

describe("SIP-001A column splitting", () => {
  it("splits on runs of 2+ spaces, keeping single interior spaces intact", () => {
    const cols = splitColumns("Unit    Type    Price (THB)   Status");
    expect(cols.map((c) => c.text)).toEqual(["Unit", "Type", "Price (THB)", "Status"]);
    expect(cols[0].start).toBe(0);
  });

  it("recognizes syntactically valid unit identities only", () => {
    expect(isSyntacticUnitIdentity("A1")).toBe(true);
    expect(isSyntacticUnitIdentity("B-101")).toBe(true);
    expect(isSyntacticUnitIdentity("Villa A4")).toBe(false);
    expect(isSyntacticUnitIdentity("Available")).toBe(false); // no digit
    expect(isSyntacticUnitIdentity("")).toBe(false);
  });
});

describe("SIP-001A table extraction — supported layout fixture", () => {
  const extraction = fixtureExtraction("generic-price-list.pdftotext-layout.txt");
  const { regions, pagesWithoutHeader } = extractDocumentTables(extraction.pages);

  it("preserves page boundaries and detects a header-bearing region on every data page", () => {
    expect(extraction.pageCount).toBe(2);
    expect(pagesWithoutHeader).toEqual([]);
  });

  it("maps the fixed header dictionary without guessing", () => {
    const region = regions[0];
    expect(region.unsupported).toBe(false);
    expect(region.header.columns.unit_number).toBe("Unit");
    expect(region.header.columns.price).toBe("Price (THB)");
    expect(region.header.currencyFromHeader).toBe("THB");
  });

  it("extracts every syntactically valid row, in source order, on page 1", () => {
    const page1Rows = regions.filter((r) => r.page === 1).flatMap((r) => r.rows);
    const identities = page1Rows.map((r) => r.cells.unit_number);
    expect(identities).toEqual(["X101", "X102", "X103", "X104", "X105", "Y201"]);
    page1Rows.forEach((row, index) => expect(row.sourceRow).toBe(index + 1));
  });

  it("recognizes a repeated header on page 2 as a continuation, not a new ambiguous table", () => {
    const page2Regions = regions.filter((r) => r.page === 2);
    expect(page2Regions).toHaveLength(1);
    expect(page2Regions[0].rows.map((r) => r.cells.unit_number)).toEqual(["Y202", "Y203"]);
  });

  it("merges a wrapped continuation line into the previous row and marks it", () => {
    const x105 = regions.flatMap((r) => r.rows).find((r) => r.cells.unit_number === "X105");
    expect(x105?.isContinuation).toBe(true);
    expect(x105?.cells.availability_status).toBe("Reserved - pending contract");
  });

  it("keeps a sold row with a dash price cell as a row (not dropped)", () => {
    const x102 = regions.flatMap((r) => r.rows).find((r) => r.cells.unit_number === "X102");
    expect(x102).toBeDefined();
    expect(x102?.cells.price).toBe("-");
  });

  it("maps the actual-layout structural features without treating land area as living size", () => {
    const multi = extractDocumentTables(
      fixtureExtraction("generic-multirow-table.pdftotext-layout.txt").pages,
    );
    expect(multi.regions).toHaveLength(1);
    expect(multi.regions[0].header.columns.land_area_sqm).toBe("Land Area");
    expect(multi.regions[0].header.columns.size_sqm).toBe("Living Area");
    expect(multi.regions[0].rows.map((row) => row.cells.unit_number)).toEqual([
      "Z11",
      "Z12",
      "Q21",
    ]);
    expect(multi.regions[0].rows[0].cells.size_sqm).toBe("305.50");
  });
});

describe("SIP-001A table extraction — unsupported/ambiguous layouts", () => {
  it("flags a duplicate-mapped header (two Price columns) as ambiguous, not a usable table", () => {
    const extraction = fixtureExtraction("ambiguous-header.pdftotext-layout.txt");
    const { regions, ambiguousHeaderLines } = extractDocumentTables(extraction.pages);
    expect(regions.filter((r) => !r.unsupported)).toHaveLength(0);
    expect(ambiguousHeaderLines.length).toBeGreaterThan(0);
  });

  it("flags a header with no unit-identity column as unsupported", () => {
    const extraction = fixtureExtraction("unsupported-no-unit-column.pdftotext-layout.txt");
    const { regions } = extractDocumentTables(extraction.pages);
    expect(regions.every((r) => r.unsupported)).toBe(true);
    expect(regions[0].unsupportedReason).toMatch(/missing_unit_identity_column/);
  });

  it("reports a page with no recognizable header as having no table", () => {
    const extraction = fixtureExtraction("empty-text-layer.pdftotext-layout.txt");
    const { pagesWithoutHeader } = extractDocumentTables(extraction.pages);
    expect(pagesWithoutHeader).toEqual([1]);
  });
});
