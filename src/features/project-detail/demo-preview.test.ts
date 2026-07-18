import { describe, expect, it } from "vitest";

import { buildCoralinaProjectDetail } from "@/features/coralina-integration/adapters/coralina-project-detail";
import {
  isDemoPreviewEnabled,
  listDemoPreviewProperties,
  mapProjectDetailToProperty,
} from "./demo-preview";

describe("Coralina demo preview adapter", () => {
  it("keeps the canonical Coralina inventory available to shared card data", () => {
    const detail = buildCoralinaProjectDetail();
    const property = mapProjectDetailToProperty(detail);

    expect(detail.core.slug).toBe("coralina");
    expect(detail.core.location).toBe("Kamala");
    expect(detail.units).toHaveLength(198);
    expect(new Set(detail.units.map((unit) => unit.buildingCode))).toEqual(
      new Set(["A", "B", "C", "D", "E", "F", "G", "H"]),
    );
    expect(property.slug).toBe("coralina");
    expect(property.startingPriceTHB).toBeGreaterThan(0);
    expect(property.constructionStatus).toBe("Not available");
    expect(property.status).toBe("Not available");
    expect(property.marketPosition).toBe("Not available");
    expect(property.verdict).toBe("Not available");
    expect(property.rentalDemand).toBe("Not available");
  });
});

describe("demo preview visibility", () => {
  it("is present in local development mode", async () => {
    expect(isDemoPreviewEnabled({ DEV: true })).toBe(true);
    await expect(listDemoPreviewProperties()).resolves.toHaveLength(1);
  });

  it("is excluded in production mode", () => {
    expect(isDemoPreviewEnabled({ DEV: false })).toBe(false);
  });
});
