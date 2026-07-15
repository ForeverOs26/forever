import { describe, expect, it } from "vitest";

import type { UnitInput } from "./database";
import { unitPersistenceProjection } from "./persistence-projection";

const unit: UnitInput = {
  unitNumber: "A-1",
  buildingCode: "A",
  currency: "THB",
  price: 1_000_000,
};

describe("unit persistence projection — building_id semantics", () => {
  it("preserves an undefined building_id verbatim (field omitted on write)", () => {
    const projection = unitPersistenceProjection("p1", undefined, unit);
    expect("building_id" in projection).toBe(true);
    expect(projection.building_id).toBeUndefined();
  });

  it("preserves an explicit null building_id (field cleared on write)", () => {
    expect(unitPersistenceProjection("p1", null, unit).building_id).toBeNull();
  });

  it("preserves a resolved building id", () => {
    expect(unitPersistenceProjection("p1", "b-1", unit).building_id).toBe("b-1");
  });
});
