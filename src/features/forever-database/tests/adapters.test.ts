import { describe, expect, it } from "vitest";

import { projectDetailToForeverRecord } from "../adapters";
import { makeInvestmentRow, makeMediaItem, makeProjectDetail, makeUnit } from "./fixtures";

describe("projectDetailToForeverRecord — project mapping", () => {
  it("maps identity, normalized status, and preserves raw strings", () => {
    const record = projectDetailToForeverRecord(makeProjectDetail());
    expect(record.project.id).toBe("project-1");
    expect(record.project.slug).toBe("the-modeva-bang-tao");
    expect(record.project.constructionStatus).toBe("planning");
    expect(record.project.ownershipType).toBe("freehold");
    expect(record.project.raw).toEqual({
      publicStatus: "Available",
      salesStatus: "Available",
      constructionStatus: "Planning",
      ownershipType: "Freehold",
    });
  });

  it("omits absent pricing and score facts rather than surfacing zeros", () => {
    const record = projectDetailToForeverRecord(makeProjectDetail());
    expect(record.project.pricing.startingPrice).toBeUndefined();
    expect(record.project.trust.trustScore).toBeUndefined();
    expect(record.project.trust.foreverVerified).toBe(true);
  });

  it("maps present pricing into canonical money", () => {
    const record = projectDetailToForeverRecord(
      makeProjectDetail({ pricing: { startingPriceTHB: 5_000_000 } }),
    );
    expect(record.project.pricing.startingPrice).toEqual({ amount: 5_000_000, currency: "THB" });
  });

  it("links developer and location by id", () => {
    const record = projectDetailToForeverRecord(makeProjectDetail());
    expect(record.developer).not.toBeNull();
    expect(record.project.developerId).toBe(record.developer?.id);
    expect(record.location).not.toBeNull();
    expect(record.project.locationId).toBe(record.location?.id);
    expect(record.location?.slug).toBe("bang-tao");
  });

  it("returns a null developer when the source has none", () => {
    const record = projectDetailToForeverRecord(makeProjectDetail({ developer: null }));
    expect(record.developer).toBeNull();
    expect(record.project.developerId).toBeUndefined();
  });
});

describe("projectDetailToForeverRecord — units and payment plans", () => {
  it("maps units and normalizes their statuses", () => {
    const record = projectDetailToForeverRecord(
      makeProjectDetail({
        units: [makeUnit({ availabilityStatus: "Reserved", basePriceTHB: 4_200_000 })],
      }),
    );
    expect(record.units).toHaveLength(1);
    expect(record.units[0].availabilityStatus).toBe("reserved");
    expect(record.units[0].availabilityStatusRaw).toBe("Reserved");
    expect(record.units[0].basePrice).toEqual({ amount: 4_200_000, currency: "THB" });
  });

  it("derives a payment plan only for units that declare one", () => {
    const record = projectDetailToForeverRecord(
      makeProjectDetail({
        units: [
          makeUnit({ id: "unit-1", paymentPlan: "30/70 plan" }),
          makeUnit({ id: "unit-2", code: "A-102", paymentPlan: "" }),
        ],
      }),
    );
    expect(record.paymentPlans).toHaveLength(1);
    expect(record.paymentPlans[0]).toMatchObject({
      id: "unit-1::payment-plan",
      unitId: "unit-1",
      name: "30/70 plan",
      milestones: [],
    });
  });
});

describe("projectDetailToForeverRecord — media vs documents split", () => {
  it("routes images/videos to media and files to documents", () => {
    const record = projectDetailToForeverRecord(
      makeProjectDetail({
        media: {
          hero: makeMediaItem({ id: "hero", type: "cover", url: "https://x/hero.jpg" }),
          gallery: [makeMediaItem({ id: "g1", url: "https://x/g1.jpg" })],
          floorPlans: [makeMediaItem({ id: "fp1", type: "floor_plan", url: "https://x/fp.jpg" })],
          masterPlan: makeMediaItem({ id: "mp", type: "master_plan", url: "https://x/mp.jpg" }),
          unitPlans: [],
          videos: [makeMediaItem({ id: "v1", type: "video", url: "https://x/v.mp4" })],
          brochures: [makeMediaItem({ id: "b1", type: "brochure", url: "https://x/b.pdf" })],
          documents: [
            {
              ...makeMediaItem({ id: "d1", type: "price_list", url: "https://x/pl.pdf" }),
              label: "Price list",
              note: "Aug 2025",
            },
          ],
        },
      }),
    );

    const mediaTypes = record.media.map((m) => m.mediaType).sort();
    expect(mediaTypes).toEqual(
      ["cover_image", "floor_plan_image", "gallery_image", "master_plan_image", "video"].sort(),
    );

    const docTypes = record.documents.map((d) => d.documentType).sort();
    expect(docTypes).toEqual(["brochure", "price_list"]);
    expect(record.documents.find((d) => d.id === "d1")).toMatchObject({
      label: "Price list",
      note: "Aug 2025",
    });

    // Project-level convenience pointers.
    expect(record.project.mainImageUrl).toBe("https://x/hero.jpg");
    expect(record.project.brochureUrl).toBe("https://x/b.pdf");
  });
});

describe("projectDetailToForeverRecord — rental vs investment split", () => {
  it("routes rental facts and ROI to separate entities without duplication", () => {
    const record = projectDetailToForeverRecord(
      makeProjectDetail({
        investment: {
          investmentValue: 6_000_000,
          rentalYield: "7%",
          rentalDemand: "High",
          capitalGrowthEstimate: "5% p.a.",
          rows: [
            makeInvestmentRow({
              id: "inv-1",
              expectedMonthlyRent: 35_000,
              occupancyRate: 80,
              annualRoiPercent: 7,
              managementCompany: "Forever Rentals",
            }),
          ],
        },
      }),
    );

    const rowRental = record.rentalInformation.find((r) => r.id === "inv-1::rental");
    expect(rowRental).toMatchObject({
      expectedMonthlyRent: { amount: 35_000, currency: "THB" },
      occupancyRatePercent: 80,
      managementCompany: "Forever Rentals",
    });
    // ROI must NOT appear on the rental record.
    expect(rowRental).not.toHaveProperty("annualRoiPercent");

    const rowInvestment = record.investmentInformation.find((i) => i.id === "inv-1::investment");
    expect(rowInvestment?.annualRoiPercent).toBe(7);

    const rentalSummary = record.rentalInformation.find(
      (r) => r.id === "project-1::rental-summary",
    );
    expect(rentalSummary).toMatchObject({ rentalYieldLabel: "7%", rentalDemand: "High" });

    const investmentSummary = record.investmentInformation.find(
      (i) => i.id === "project-1::investment-summary",
    );
    expect(investmentSummary).toMatchObject({
      investmentValue: { amount: 6_000_000, currency: "THB" },
      capitalGrowthEstimate: "5% p.a.",
    });
  });

  it("emits no rental/investment records when there are no such facts", () => {
    const record = projectDetailToForeverRecord(makeProjectDetail());
    expect(record.rentalInformation).toEqual([]);
    expect(record.investmentInformation).toEqual([]);
  });

  it("keeps a unit reference only when the unit exists in the record", () => {
    const record = projectDetailToForeverRecord(
      makeProjectDetail({
        units: [makeUnit({ id: "unit-1" })],
        investment: {
          rows: [
            makeInvestmentRow({ id: "inv-1", unitId: "unit-1", expectedMonthlyRent: 10_000 }),
            makeInvestmentRow({ id: "inv-2", unitId: "ghost", expectedMonthlyRent: 20_000 }),
          ],
        },
      }),
    );
    expect(record.rentalInformation.find((r) => r.id === "inv-1::rental")?.unitId).toBe("unit-1");
    expect(record.rentalInformation.find((r) => r.id === "inv-2::rental")?.unitId).toBeUndefined();
  });
});

describe("projectDetailToForeverRecord — construction progress", () => {
  it("derives one project-level construction record from the status", () => {
    const record = projectDetailToForeverRecord(makeProjectDetail());
    expect(record.constructionProgress).toHaveLength(1);
    expect(record.constructionProgress[0]).toMatchObject({
      id: "project-1::construction",
      status: "planning",
      statusRaw: "Planning",
    });
  });

  it("emits no construction record when the status is absent", () => {
    const record = projectDetailToForeverRecord(
      makeProjectDetail({ core: { constructionStatus: "" } }),
    );
    expect(record.constructionProgress).toEqual([]);
  });
});
