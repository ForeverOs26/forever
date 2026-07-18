import { describe, expect, it } from "vitest";

import { buildCoralinaProjectDetail } from "@/features/coralina-integration/adapters/coralina-project-detail";
import { mapProjectDetailToProperty } from "./demo-preview";

describe("Coralina demo preview adapter", () => {
  it("keeps the canonical Coralina inventory available to shared card data", () => {
    const detail = buildCoralinaProjectDetail();
    const property = mapProjectDetailToProperty(detail);

    expect(detail.core.slug).toBe("coralina");
    expect(detail.core.location).toBe("Kamala");
    expect(detail.units).toHaveLength(198);
    expect(new Set(detail.units.map((unit) => unit.code.slice(2, 3)))).toEqual(
      new Set(["A", "B", "C", "D", "E", "F", "G", "H"]),
    );
    expect(property.slug).toBe("coralina");
    expect(property.startingPriceTHB).toBeGreaterThan(0);
  });
});
