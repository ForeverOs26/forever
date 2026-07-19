import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildModevaPartnerDemoProjectDetail,
  getPartnerDemoProjectDetail,
  listPartnerDemoProperties,
} from "./partner-demo-data";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Partner Demo committed project adapter", () => {
  it("reconstructs the sparse published Modeva record from committed evidence", () => {
    const project = buildModevaPartnerDemoProjectDetail();
    expect(project.core).toMatchObject({
      slug: "modeva",
      name: "Modeva",
      type: "Condominium",
      status: "Available",
      constructionStatus: "Planning",
      ownershipType: "Freehold",
      location: "Bang Tao",
    });
    expect(project.developer?.name).toBe("Title");
    expect(project.units).toHaveLength(289);
    expect(project.units[0]).toMatchObject({
      code: "MBA101",
      buildingCode: "A",
      type: "1 BEDROOM LA",
      bedrooms: 1,
      sizeSqm: 43,
      basePriceTHB: 7_525_000,
    });
  });

  it("does not promote sparse placeholders into partner-facing claims", () => {
    const project = buildModevaPartnerDemoProjectDetail();
    expect(project.pricing.startingPriceTHB).toBe(0);
    expect(project.trust.foreverVerified).toBe(false);
    expect(project.trust.trustScore).toBe(0);
    expect(project.trust.verdict).toBe("");
    expect(project.investment.rentalYield).toBe("");
    expect(project.trust.lastInspection).toBe("");
  });

  it("activates only for the explicit local Partner Demo process", async () => {
    vi.stubEnv("VITE_PARTNER_DEMO", "false");
    await expect(getPartnerDemoProjectDetail("modeva")).resolves.toBeNull();
    await expect(listPartnerDemoProperties()).resolves.toBeNull();

    vi.stubEnv("VITE_PARTNER_DEMO", "true");
    await expect(listPartnerDemoProperties()).resolves.toMatchObject([
      { slug: "modeva" },
      { slug: "coralina" },
    ]);
  }, 15_000);
});
