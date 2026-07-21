import { describe, expect, it } from "vitest";

import { mapProjectDetail } from "./project-detail-mappers";
import type { ProjectDetail, ProjectDetailRecord } from "./project-detail-types";
import {
  buildProjectStructuredData,
  mapRecordedStatusToAvailability,
} from "./project-structured-data";

/**
 * FOREVER-TRUTH-001A JSON-LD regressions: structured data must follow the
 * same truth boundary as the visible page — closed availability whitelist,
 * no inferred geography, no absence sentinels, and no channel for the
 * evidence-unproven legacy advisory scalars.
 */

function detail(overrides: {
  core?: Partial<ProjectDetail["core"]>;
  pricing?: Partial<ProjectDetail["pricing"]>;
  trust?: Partial<ProjectDetail["trust"]>;
  investment?: Partial<ProjectDetail["investment"]>;
}): ProjectDetail {
  return {
    core: {
      id: "p1",
      slug: "sparse",
      name: "Sparse Project",
      type: "",
      status: "",
      constructionStatus: "",
      ownershipType: "",
      location: "",
      address: "",
      tagline: "",
      description: "",
      highlights: [],
      beds: "",
      area: "",
      isFeatured: false,
      isActive: true,
      developerNameRaw: "",
      locationNameRaw: "",
      ...overrides.core,
    },
    pricing: {
      startingPriceTHB: 0,
      displayPrice: "",
      priceRange: "",
      pricePerSqm: "",
      verifiedPrice: "",
      promotion: "",
      lastPriceUpdate: "",
      ...overrides.pricing,
    },
    trust: {
      foreverVerified: false,
      trustScore: 0,
      trustNote: "",
      marketPosition: "",
      verdict: "",
      lastInspection: "",
      ...overrides.trust,
    },
    investment: {
      investmentValue: 0,
      rentalYield: "",
      rentalDemand: "",
      capitalGrowthEstimate: "",
      rows: [],
      ...overrides.investment,
    },
    location: {
      area: "",
      latitude: null,
      longitude: null,
      distanceToBeach: "",
      distanceToAirport: "",
      nearbySchools: [],
      nearbyHospitals: [],
      lifestyle: [],
    },
    developer: null,
    media: {
      hero: null,
      gallery: [],
      floorPlans: [],
      masterPlan: null,
      unitPlans: [],
      brochures: [],
      videos: [],
      documents: [],
    },
    units: [],
  } as unknown as ProjectDetail;
}

function allJson(project: ProjectDetail): string {
  return buildProjectStructuredData(project, "https://example.com/projects/x")
    .map((script) => script.children)
    .join("\n");
}

describe("JSON-LD availability whitelist", () => {
  it("maps only explicitly recorded selling states", () => {
    expect(mapRecordedStatusToAvailability("Available")).toBe("https://schema.org/InStock");
    expect(mapRecordedStatusToAvailability("Selling")).toBe("https://schema.org/InStock");
    expect(mapRecordedStatusToAvailability("Sold Out")).toBe("https://schema.org/SoldOut");
    expect(mapRecordedStatusToAvailability("")).toBeUndefined();
    expect(mapRecordedStatusToAvailability("Not available")).toBeUndefined();
    expect(mapRecordedStatusToAvailability("draft")).toBeUndefined();
    expect(mapRecordedStatusToAvailability("Reserved")).toBeUndefined();
  });

  it("omits availability entirely for an unrecorded or unknown status", () => {
    const priced = detail({ pricing: { startingPriceTHB: 5_000_000 } });
    expect(allJson(priced)).not.toContain("availability");

    const oddStatus = detail({
      core: { status: "Not available" },
      pricing: { startingPriceTHB: 5_000_000 },
    });
    expect(allJson(oddStatus)).not.toContain("availability");
    expect(allJson(oddStatus)).not.toContain("InStock");
  });

  it("emits availability for a recorded selling state", () => {
    const selling = detail({
      core: { status: "Available" },
      pricing: { startingPriceTHB: 5_000_000 },
    });
    expect(allJson(selling)).toContain("https://schema.org/InStock");

    const soldOut = detail({
      core: { status: "Sold Out" },
      pricing: { startingPriceTHB: 5_000_000 },
    });
    expect(allJson(soldOut)).toContain("https://schema.org/SoldOut");
  });
});

describe("JSON-LD geography", () => {
  it("never infers region or country", () => {
    const json = allJson(detail({ core: { location: "Bang Tao" } }));
    expect(json).not.toContain("addressRegion");
    expect(json).not.toContain("addressCountry");
    expect(json).not.toContain('"TH"');
    expect(json).toContain('"addressLocality":"Bang Tao"');
  });

  it("omits the address entirely when no locality is recorded", () => {
    const json = allJson(detail({}));
    expect(json).not.toContain("PostalAddress");
    expect(json).not.toContain("addressLocality");
  });
});

describe("JSON-LD truth boundary", () => {
  it("never serializes the absence sentinel or empty descriptions", () => {
    const json = allJson(
      detail({ core: { status: "Not available", constructionStatus: "Not available" } }),
    );
    expect(json).not.toContain("Not available");
    expect(json).not.toContain('"description":""');
  });

  it("provides no channel for the evidence-unproven advisory scalars", () => {
    // Even a crafted object carrying legacy scalar values must not leak them
    // into structured data — the builder has no code path for these fields.
    const crafted = detail({
      trust: {
        foreverVerified: true,
        trustScore: 9.9,
        marketPosition: "Below market",
        verdict: "Strong Buy",
        lastInspection: "2026-06-01",
      },
      investment: {
        investmentValue: 9.5,
        rentalYield: "8%",
        rentalDemand: "Very High",
        capitalGrowthEstimate: "7% p.a.",
      },
      pricing: { verifiedPrice: "THB 9,999,999" },
    });
    const json = allJson(crafted);
    expect(json).not.toContain("Forever Score");
    expect(json).not.toContain("Investment Value");
    expect(json).not.toContain("Market Position");
    expect(json).not.toContain("Forever Verdict");
    expect(json).not.toContain("Rental Yield");
    expect(json).not.toContain("Capital Growth");
    expect(json).not.toContain("Strong Buy");
    expect(json).not.toContain("verified");
  });

  it("keeps recorded descriptive facts", () => {
    const json = allJson(
      detail({
        core: {
          status: "Available",
          constructionStatus: "Planning",
          type: "Condominium",
          description: "A recorded description.",
        },
        pricing: { startingPriceTHB: 4_500_000 },
      }),
    );
    expect(json).toContain("Construction Status");
    expect(json).toContain("Planning");
    expect(json).toContain('"category":"Condominium"');
    expect(json).toContain("A recorded description.");
    expect(json).toContain('"price":4500000');
  });
});

describe("mapper-to-JSON-LD end to end with the Modeva legacy shape", () => {
  it("the real placeholder row produces no verification, score, or verdict claims", () => {
    const modevaLegacyRow = {
      id: "modeva-id",
      slug: "modeva",
      name: "Modeva",
      project_type: "Condominium",
      sales_status: "Available",
      construction_status: "Planning",
      ownership_type: "Freehold",
      location_area: "Bang Tao",
      address: "Bang Tao, Phuket, Thailand",
      tagline: "Verified Bang Tao project reviewed through the Forever decision framework.",
      short_description: null,
      full_description: "Modeva is the first canonical seed project.",
      highlights: ["Forever Verified project record"],
      beds_display: null,
      area_range: null,
      is_featured: true,
      is_active: true,
      developer_name_raw: null,
      location_name_raw: null,
      starting_price_thb: null,
      price_range: null,
      price_per_sqm_display: null,
      verified_price: "",
      promotion: "",
      last_price_update: null,
      forever_verified: true,
      trust_score: 0,
      trust_note: "Awaiting full Forever inspection data.",
      market_position: "Under review",
      verdict: "Under Review",
      last_inspection: "",
      investment_value: 0,
      rental_yield: "",
      rental_demand: "",
      capital_growth_estimate: "",
      latitude: null,
      longitude: null,
      distance_to_beach: "Bang Tao area",
      distance_to_airport: null,
      nearby_schools: null,
      nearby_hospitals: null,
      lifestyle: null,
      main_image_url: null,
      brochure_url: null,
      developer: null,
      media: [],
      units: [],
      investment: [],
    } as unknown as ProjectDetailRecord;

    const mapped = mapProjectDetail(modevaLegacyRow);
    expect(mapped.trust.foreverVerified).toBe(false);
    expect(mapped.trust.verdict).toBe("");
    expect(mapped.trust.marketPosition).toBe("");
    expect(mapped.trust.trustNote).toBe("");

    const json = buildProjectStructuredData(mapped, "https://example.com/projects/modeva")
      .map((script) => script.children)
      .join("\n");
    expect(json).not.toContain("Forever Verdict");
    expect(json).not.toContain("Under Review");
    expect(json).not.toContain("Market Position");
    expect(json).not.toContain("addressRegion");
    expect(json).not.toContain("addressCountry");
    // Descriptive facts survive.
    expect(json).toContain("Construction Status");
    expect(json).toContain('"addressLocality":"Bang Tao"');
  });
});
