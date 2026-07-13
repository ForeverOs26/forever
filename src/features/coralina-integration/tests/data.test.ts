import { describe, expect, it } from "vitest";

import {
  CORALINA_BUILDINGS,
  CORALINA_DATA_GAPS,
  CORALINA_DOCUMENT_FACTS,
  CORALINA_MEDIA_FACTS,
  CORALINA_UNIT_FACTS,
  CORALINA_UNIT_TYPES,
} from "../data";

describe("Coralina verified data", () => {
  it("carries the full verified price-list inventory (198 units)", () => {
    expect(CORALINA_UNIT_FACTS).toHaveLength(198);
    expect(CORALINA_BUILDINGS).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    expect(CORALINA_UNIT_TYPES).toHaveLength(7);
  });

  it("has no duplicate unit numbers (natural keys are unique)", () => {
    const numbers = CORALINA_UNIT_FACTS.map((u) => u.unitNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("carries verified documents and media", () => {
    expect(CORALINA_DOCUMENT_FACTS.length).toBeGreaterThan(0);
    expect(CORALINA_MEDIA_FACTS.length).toBeGreaterThan(0);
    // media source files are unique natural keys
    const files = CORALINA_MEDIA_FACTS.map((m) => m.sourceFile);
    expect(new Set(files).size).toBe(files.length);
  });

  it("preserves prices verbatim but asserts NO currency (anti-fabrication)", () => {
    // Every unit carries a verbatim price string; none carries a currency field.
    for (const unit of CORALINA_UNIT_FACTS) {
      expect(typeof unit.price).toBe("string");
      expect(unit.price.length).toBeGreaterThan(0);
      expect(unit).not.toHaveProperty("currency");
    }
  });

  it("records every remaining known data gap explicitly", () => {
    const joined = CORALINA_DATA_GAPS.join(" | ").toLowerCase();
    expect(joined).toContain("currency");
    expect(joined).not.toContain("source_pending");
    expect(joined).toContain("construction");
    expect(joined).toContain("coordinates");
    expect(joined).toContain("rental");
    expect(joined).toContain("investment");
  });

  it("keeps units with no recorded bedrooms as null, never a placeholder", () => {
    for (const unit of CORALINA_UNIT_FACTS) {
      expect(unit.bedrooms === null || typeof unit.bedrooms === "number").toBe(true);
    }
  });
});
