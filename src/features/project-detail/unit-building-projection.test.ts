/**
 * FOREVER-PRODUCTION-ACTIVATION-001 — the public unit projection.
 *
 * The Inventory table renders a building, a price and an availability state per
 * unit. Those values must arrive from the columns the public role is actually
 * granted, and nothing else: the building code comes from the embedded
 * `buildings` row, the price from `units.base_price_thb` (written by the
 * direct-publish price projection), and a unit whose building the record does
 * not state maps to no building rather than an invented one.
 */

import { describe, expect, it } from "vitest";

import { mapProjectDetail, mapProjectUnit } from "./project-detail-mappers";
import type { ProjectDetailRecord, UnitRowWithBuilding } from "./project-detail-types";

function unitRow(overrides: Partial<UnitRowWithBuilding> = {}): UnitRowWithBuilding {
  return {
    id: "u-1",
    project_id: "p-1",
    unit_code: "A308",
    unit_type: "One Bedroom Legend",
    bedrooms: 1,
    bathrooms: null,
    size_sqm: 65.4,
    floor: 3,
    view_type: null,
    ownership_type: null,
    base_price_thb: 9244800,
    discounted_price_thb: null,
    price_per_sqm: null,
    availability_status: "available",
    payment_plan: null,
    furniture_package: null,
    rental_guarantee: null,
    roi_estimate: null,
    notes: null,
    building: { building_code: "A" },
    ...overrides,
  } as unknown as UnitRowWithBuilding;
}

function record(units: UnitRowWithBuilding[]): ProjectDetailRecord {
  return {
    id: "p-1",
    slug: "the-title-legendary",
    name: "The Title Legendary",
    is_featured: false,
    is_active: true,
    developer: null,
    media: null,
    units,
    investment: null,
  } as unknown as ProjectDetailRecord;
}

describe("unit building/price projection", () => {
  it("maps the embedded building code onto the unit", () => {
    expect(mapProjectUnit(unitRow()).buildingCode).toBe("A");
  });

  it("maps the projected THB price from the public-safe column", () => {
    expect(mapProjectUnit(unitRow()).basePriceTHB).toBe(9244800);
  });

  it("omits the building rather than inventing one when the record has none", () => {
    for (const building of [null, undefined, { building_code: null }]) {
      const mapped = mapProjectUnit(unitRow({ building } as Partial<UnitRowWithBuilding>));
      expect(mapped.buildingCode).toBeUndefined();
    }
  });

  it("keeps a sold unit's recorded price while reporting it as sold", () => {
    const mapped = mapProjectUnit(
      unitRow({ unit_code: "I501", availability_status: "sold", base_price_thb: 9045000 }),
    );
    expect(mapped.availabilityStatus).toBe("sold");
    expect(mapped.basePriceTHB).toBe(9045000);
  });

  it("carries no source metadata into the public view model", () => {
    const mapped = mapProjectUnit(unitRow()) as Record<string, unknown>;
    for (const key of ["metadata", "field_provenance", "source_file", "building_id"]) {
      expect(mapped).not.toHaveProperty(key);
    }
  });

  it("projects a whole project's units through the detail mapper", () => {
    const detail = mapProjectDetail(
      record([
        unitRow({ id: "u-1", unit_code: "A308", building: { building_code: "A" } }),
        unitRow({
          id: "u-2",
          unit_code: "I501",
          availability_status: "sold",
          base_price_thb: 9045000,
          building: { building_code: "I" },
        }),
      ]),
    );

    expect(detail.units).toHaveLength(2);
    expect(detail.units.map((unit) => unit.buildingCode)).toEqual(["A", "I"]);
    const sold = detail.units.find((unit) => unit.code === "I501");
    expect(sold?.availabilityStatus).toBe("sold");
    expect(sold?.basePriceTHB).toBe(9045000);
  });

  it("renders no price when the projection left the column null", () => {
    // A non-THB or unknown-currency price projects to NULL by design.
    expect(mapProjectUnit(unitRow({ base_price_thb: null })).basePriceTHB).toBeNull();
  });
});
