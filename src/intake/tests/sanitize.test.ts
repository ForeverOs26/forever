import { describe, expect, it } from "vitest";

import type { ExtractedPriceList } from "@/import/types";

import {
  IntakeConflictError,
  isSentinelValue,
  isUsableCountry,
  isUsableFactValue,
  isValidIsoDate,
  parsePositivePrice,
  sanitizePriceList,
  usableIntakeFact,
} from "../sanitize";
import type { IntakeFact } from "../types";

describe("Fast Intake anti-fabrication value guards", () => {
  it("treats sentinels and blanks as non-facts", () => {
    for (const s of [
      "",
      "  ",
      "Not available",
      "not available",
      "Unknown",
      "N/A",
      "n/a",
      "TBD",
      "-",
      "—",
      "null",
    ]) {
      expect(isSentinelValue(s) || !isUsableFactValue(s)).toBe(true);
    }
    expect(isUsableFactValue("Rhom Bho Property")).toBe(true);
  });

  it("validates ISO dates strictly", () => {
    expect(isValidIsoDate("2026-07-01")).toBe(true);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("07/01/2026")).toBe(false);
    expect(isValidIsoDate("not-a-date")).toBe(false);
  });

  it("validates country plausibility", () => {
    expect(isUsableCountry("Thailand")).toBe(true);
    expect(isUsableCountry("United Arab Emirates")).toBe(true);
    expect(isUsableCountry("Unknown")).toBe(false);
    expect(isUsableCountry("123")).toBe(false);
    expect(isUsableCountry("")).toBe(false);
  });

  it("parses only strictly positive numeric prices", () => {
    expect(parsePositivePrice("4,500,000")).toBe(4500000);
    expect(parsePositivePrice("0")).toBeNull();
    expect(parsePositivePrice("-100")).toBeNull();
    expect(parsePositivePrice("abc")).toBeNull();
    expect(parsePositivePrice("")).toBeNull();
  });

  it("usableIntakeFact enforces value, confidence, source ref, and date", () => {
    const good: IntakeFact = { value: "Dev Co", confidence: "high", source_ref: "facts.json" };
    expect(usableIntakeFact(good)?.value).toBe("Dev Co");
    expect(usableIntakeFact({ value: "Dev Co", confidence: "none", source_ref: "x" })).toBeNull();
    expect(
      usableIntakeFact({ value: "Dev Co", confidence: "bogus" as never, source_ref: "x" }),
    ).toBeNull();
    expect(usableIntakeFact({ value: "Dev Co", confidence: "high" })).toBeNull(); // no source ref
    expect(usableIntakeFact({ value: "Unknown", confidence: "high", source_ref: "x" })).toBeNull();
    expect(
      usableIntakeFact({ value: "Dev", confidence: "high", source_ref: "x", source_date: "bad" }),
    ).toBeNull();
  });
});

function priceList(rows: unknown[]): ExtractedPriceList {
  return { unit_inventory: rows } as unknown as ExtractedPriceList;
}
const F = (value: unknown, confidence = "high") => ({ value, source_file: "pl.json", confidence });

describe("Fast Intake price-list sanitization", () => {
  it("nulls a zero/negative price and warns", () => {
    const result = sanitizePriceList(
      priceList([{ unit_number: F("A-1"), building: F("A"), price: F("0") }]),
    );
    expect(result.warnings.map((w) => w.code)).toContain("price_invalid");
  });

  it("nulls an unsupported currency and warns", () => {
    const result = sanitizePriceList(
      priceList([
        { unit_number: F("A-1"), building: F("A"), price: F("1000"), currency: F("XYZ") },
      ]),
    );
    expect(result.warnings.map((w) => w.code)).toContain("currency_unsupported");
  });

  it("skips rows with a missing unit identifier and warns", () => {
    const result = sanitizePriceList(
      priceList([
        { unit_number: F(null, "none"), building: F("A"), price: F("1000") },
        { unit_number: F("A-2"), building: F("A"), price: F("2000") },
      ]),
    );
    expect(result.skippedRows).toBe(1);
    expect(result.warnings.map((w) => w.code)).toContain("unit_identifier_missing");
    expect(result.priceList?.unit_inventory).toHaveLength(1);
  });

  it("rejects duplicate unit identifiers as a blocking conflict", () => {
    expect(() =>
      sanitizePriceList(
        priceList([
          { unit_number: F("A-1"), building: F("A"), price: F("1000") },
          { unit_number: F("A-1"), building: F("A"), price: F("2000") },
        ]),
      ),
    ).toThrow(IntakeConflictError);
  });

  it("keeps a valid supported-currency row untouched", () => {
    const result = sanitizePriceList(
      priceList([
        { unit_number: F("A-1"), building: F("A"), price: F("1000"), currency: F("USD") },
      ]),
    );
    expect(result.warnings).toHaveLength(0);
    expect(result.priceList?.unit_inventory).toHaveLength(1);
  });
});
