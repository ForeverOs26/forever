/**
 * Parser registry: one reusable layout family per document SHAPE, never per
 * developer. Each test names a real variation the official documents contain.
 */

import { describe, expect, it } from "vitest";

import { parseCondoSchedule, unitCodeAgrees } from "../parsers/condo-schedule";
import { BUILT_IN_LAYOUTS, parseWithRegistry, selectLayout } from "../parsers/registry";
import { resolvePricePair, satisfiesPriceInvariant, healSplitNumbers } from "../parsers/shared";
import {
  landAreaAgrees,
  parseVillaSchedule,
  plotCodeAgreesWithType,
} from "../parsers/villa-schedule";

import {
  CONDO_AREA_PSQM_TOTAL,
  CONDO_AREA_TOTAL_PSQM,
  CONDO_AWKWARD_ROOM_TYPES,
  CONDO_MULTI_PAGE,
  CONDO_NO_BUILDING_NO_FLOOR,
  CONDO_WITH_CODE_DISAGREEMENT,
  CONDO_WITH_SHIFTED_ROW,
  CONDO_WITH_SPLIT_NUMBERS,
  UNSUPPORTED_LAYOUT,
  VILLA_SCHEDULE,
  VILLA_WITH_LAND_MISMATCH,
} from "./fixtures";

describe("price invariant", () => {
  it("accepts area x price-per-sqm ~= total within tolerance", () => {
    expect(satisfiesPriceInvariant(64, 146_556, 9_379_584)).toBe(true);
    expect(satisfiesPriceInvariant(64, 146_556, 9_999_999)).toBe(false);
  });

  it("derives which money column is which, in both orders", () => {
    expect(resolvePricePair(64, 146_556, 9_379_584)?.order).toBe("area_psqm_total");
    expect(resolvePricePair(43, 7_525_000, 175_000)?.order).toBe("area_total_psqm");
  });

  it("refuses to choose when neither order fits", () => {
    expect(resolvePricePair(40, 150_000, 9_999_999)).toBeNull();
  });

  it("heals a thousands group split by a cell gap without merging columns", () => {
    expect(healSplitNumbers("141,  290  5,651,  600.00")).toBe("141,290  5,651,600.00");
    expect(healSplitNumbers("124.20      141,750")).toBe("124.20      141,750");
  });
});

describe("condo-schedule-v1", () => {
  it("parses the area / price-per-sqm / total order", () => {
    const result = parseCondoSchedule(CONDO_AREA_PSQM_TOTAL);
    expect(result.accepted).toHaveLength(3);
    expect(result.observedOrder).toBe("area_psqm_total");
    expect(result.accepted[0]).toMatchObject({
      unitCode: "CKA201",
      building: "A",
      floor: 2,
      sizeSqm: 64,
      pricePerSqm: 146_556,
      totalPrice: 9_379_584,
    });
  });

  it("parses the OPPOSITE area / total / price-per-sqm order with the same code", () => {
    const result = parseCondoSchedule(CONDO_AREA_TOTAL_PSQM);
    expect(result.accepted).toHaveLength(3);
    expect(result.observedOrder).toBe("area_total_psqm");
    expect(result.accepted[0]).toMatchObject({
      unitCode: "MBA101",
      pricePerSqm: 175_000,
      totalPrice: 7_525_000,
    });
  });

  it("accepts a numeric room-type prefix, a hyphenated penthouse and parentheses", () => {
    const result = parseCondoSchedule(CONDO_AWKWARD_ROOM_TYPES);
    expect(result.rejected).toHaveLength(0);
    expect(result.accepted.map((row) => row.unitType)).toEqual([
      "1 BEDROOM L",
      "PH-3 BEDROOM C - GD",
      "1 BEDROOM S(M)",
    ]);
  });

  it("rejects a shifted row instead of assigning it a price", () => {
    const result = parseCondoSchedule(CONDO_WITH_SHIFTED_ROW);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toBe("price_invariant_unsatisfied");
  });

  it("rejects a row whose unit code disagrees with its own tower and floor", () => {
    const result = parseCondoSchedule(CONDO_WITH_CODE_DISAGREEMENT);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected[0].reason).toBe("unit_code_disagrees_with_tower_or_floor");
  });

  it("reads prices whose thousands groups were split by whitespace", () => {
    const result = parseCondoSchedule(CONDO_WITH_SPLIT_NUMBERS);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].totalPrice).toBe(5_651_600);
  });

  it("skips a repeated page header and counts pages", () => {
    const result = parseCondoSchedule(CONDO_MULTI_PAGE);
    expect(result.accepted).toHaveLength(2);
    expect(result.accepted[1].page).toBe(2);
  });

  it("parses a schedule with no building and no floor column", () => {
    const result = parseCondoSchedule(CONDO_NO_BUILDING_NO_FLOOR);
    expect(result.accepted).toHaveLength(2);
    expect(result.accepted[0].building).toBeNull();
    expect(result.accepted[0].floor).toBeNull();
  });

  it("agrees on unit code / tower / floor only when the code carries them", () => {
    expect(unitCodeAgrees("MBA101", "A", 1)).toBe(true);
    expect(unitCodeAgrees("MBA101", "A", 3)).toBe(false);
    expect(unitCodeAgrees("MBA101", "B", 1)).toBe(false);
    // No parseable structure: not a disagreement.
    expect(unitCodeAgrees("PLOT-9", "A", 1)).toBe(true);
  });
});

describe("villa-schedule-v1", () => {
  it("validates a villa list that has no price-per-sqm column", () => {
    const result = parseVillaSchedule(VILLA_SCHEDULE);
    expect(result.accepted).toHaveLength(3);
    expect(result.accepted[0]).toMatchObject({
      unitCode: "AVA12",
      landAreaSqm: 400,
      pricePerSqm: null,
      totalPrice: 25_000_000,
    });
    expect(result.validationMethod).toContain("square_wah_times_four_equals_sqm");
  });

  it("rejects a villa row whose sq.wah and sq.m disagree", () => {
    const result = parseVillaSchedule(VILLA_WITH_LAND_MISMATCH);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0].reason).toBe("land_area_wah_sqm_mismatch");
  });

  it("checks sq.wah x 4 = sq.m and plot-code/type agreement", () => {
    expect(landAreaAgrees(100, 400)).toBe(true);
    expect(landAreaAgrees(100, 999)).toBe(false);
    expect(plotCodeAgreesWithType("AVA12", "Type A")).toBe(true);
    expect(plotCodeAgreesWithType("MVA03", "Type X")).toBe(false);
  });
});

describe("layout selection", () => {
  it("selects by observed structure, not by developer or filename", () => {
    expect(selectLayout(CONDO_AREA_PSQM_TOTAL)?.layout.id).toBe("condo-schedule-v1");
    expect(selectLayout(VILLA_SCHEDULE)?.layout.id).toBe("villa-schedule-v1");
  });

  it("returns null for a document that matches no registered layout", () => {
    expect(selectLayout(UNSUPPORTED_LAYOUT)).toBeNull();
    expect(parseWithRegistry(UNSUPPORTED_LAYOUT)).toBeNull();
  });

  it("exposes every built-in layout with a stable id and a description", () => {
    for (const layout of BUILT_IN_LAYOUTS) {
      expect(layout.id).toMatch(/^[a-z0-9-]+$/);
      expect(layout.description.length).toBeGreaterThan(20);
    }
  });
});
