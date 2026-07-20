import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listDemoPreviewProperties, listPartnerDemoProperties, from } = vi.hoisted(() => ({
  listDemoPreviewProperties: vi.fn(),
  listPartnerDemoProperties: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from },
}));

vi.mock("@/features/project-detail/demo-preview", () => ({
  listDemoPreviewProperties,
}));

vi.mock("@/features/project-detail/partner-demo-data", () => ({
  listPartnerDemoProperties,
}));

import { ProjectService } from "./project-service";
import { KNOWN_FICTITIOUS_PROJECT_SLUGS } from "./public-truth";

function projectRow(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    slug,
    name: slug,
    developer: { name: "Developer" },
    media: [],
    is_active: true,
    is_featured: false,
    created_at: "2026-01-01",
    project_type: "Villa",
    ...overrides,
  };
}

function preview(slug = "coralina") {
  return {
    slug,
    name: slug,
    developer: "",
    location: "Kamala",
    propertyType: "Residence" as const,
    constructionStatus: "Not available" as const,
    status: "Not available" as const,
    tagline: "",
    description: "",
    highlights: [],
    beds: "",
    area: "",
    price: "",
    startingPriceTHB: 0,
    priceRange: "",
    pricePerSqm: "",
    lastPriceUpdate: "",
    verifiedPrice: "",
    promotion: "",
    foreverVerified: false,
    trustScore: 0,
    trustNote: "",
    investmentValue: 0,
    marketPosition: "Not available" as const,
    verdict: "Not available" as const,
    distanceToBeach: "",
    distanceToAirport: "",
    nearbySchools: [],
    nearbyHospitals: [],
    lifestyle: [],
    rentalYield: "",
    rentalDemand: "Not available" as const,
    capitalGrowthEstimate: "",
    startDate: "",
    completionDate: "",
    lastInspection: "",
    image: "",
    gallery: [],
    floorPlans: [],
    brochures: [],
    videos: [],
  };
}

function stubQueryResult(result: { data: unknown; error: null }) {
  const query: Record<string, unknown> = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(),
  };
  (query.select as ReturnType<typeof vi.fn>).mockReturnValue(query);
  (query.eq as ReturnType<typeof vi.fn>).mockReturnValue(query);
  (query.order as ReturnType<typeof vi.fn>).mockReturnValue(query);
  (query.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({
    data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
    error: null,
  });
  query.then = Promise.resolve(result).then.bind(Promise.resolve(result));
  from.mockReturnValue(query);
  return query;
}

beforeEach(() => {
  vi.stubEnv("VITE_PARTNER_DEMO", "false");
  from.mockClear();
  stubQueryResult({ data: [projectRow("modeva"), projectRow("other")], error: null });
  listDemoPreviewProperties.mockResolvedValue([preview()]);
  listPartnerDemoProperties.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ProjectService.listActive", () => {
  it("returns every published project and enabled demo preview without a limit", async () => {
    await expect(ProjectService.listActive()).resolves.toMatchObject([
      { slug: "modeva" },
      { slug: "other" },
      { slug: "coralina" },
    ]);
  });

  it("applies an exact limit after combining published projects and previews", async () => {
    await expect(ProjectService.listActive({ limit: 2 })).resolves.toHaveLength(2);
    expect((from.mock.results[0]?.value as Record<string, unknown>).limit).toBeUndefined();
  });

  it("uses committed local data without touching Supabase in Partner Demo mode", async () => {
    vi.stubEnv("VITE_PARTNER_DEMO", "true");
    listPartnerDemoProperties.mockResolvedValue([preview("modeva"), preview("coralina")]);

    await expect(ProjectService.listActive()).resolves.toMatchObject([
      { slug: "modeva" },
      { slug: "coralina" },
    ]);
    expect(from).not.toHaveBeenCalled();
  });

  it("excludes every known-fictitious seed project even when the database still returns it", async () => {
    stubQueryResult({
      data: [
        projectRow("modeva"),
        ...KNOWN_FICTITIOUS_PROJECT_SLUGS.map((slug) => projectRow(slug)),
      ],
      error: null,
    });
    listDemoPreviewProperties.mockResolvedValue([]);

    const projects = await ProjectService.listActive();
    expect(projects.map((p) => p.slug)).toEqual(["modeva"]);
  });
});

describe("ProjectService fail-closed mapping (FOREVER-TRUTH-001A)", () => {
  it("never turns missing evidence into a positive claim", async () => {
    stubQueryResult({
      data: [
        projectRow("sparse", {
          project_type: null,
          construction_status: null,
          sales_status: null,
          forever_verified: null,
          verdict: null,
          market_position: null,
          rental_demand: null,
          trust_score: null,
          investment_value: null,
          verified_price: null,
          price_range: "฿8M – ฿30M",
          main_image_url: null,
          image_key: "villaSurin",
        }),
      ],
      error: null,
    });
    listDemoPreviewProperties.mockResolvedValue([]);

    const [sparse] = await ProjectService.listActive();
    expect(sparse.foreverVerified).toBe(false);
    expect(sparse.verdict).toBe("Not available");
    expect(sparse.marketPosition).toBe("Not available");
    expect(sparse.rentalDemand).toBe("Not available");
    expect(sparse.status).toBe("Not available");
    expect(sparse.constructionStatus).toBe("Not available");
    expect(sparse.propertyType).toBe("Not available");
    expect(sparse.trustScore).toBe(0);
    expect(sparse.investmentValue).toBe(0);
    // An unverified marketing price range must never become a verified price.
    expect(sparse.verifiedPrice).toBe("");
    // A missing photo stays missing — no bundled stock image, no image_key fallback.
    expect(sparse.image).toBe("");
    expect(sparse.gallery).toEqual([]);
  });

  it("keeps explicitly recorded evidence intact", async () => {
    stubQueryResult({
      data: [
        projectRow("recorded", {
          forever_verified: true,
          verdict: "Wait for Better Pricing",
          market_position: "Below market",
          rental_demand: "High",
          verified_price: "THB 5,000,000",
          main_image_url: "https://cdn.example.com/recorded.jpg",
        }),
      ],
      error: null,
    });
    listDemoPreviewProperties.mockResolvedValue([]);

    const [recorded] = await ProjectService.listActive();
    expect(recorded.foreverVerified).toBe(true);
    expect(recorded.verdict).toBe("Wait for Better Pricing");
    expect(recorded.marketPosition).toBe("Below market");
    expect(recorded.rentalDemand).toBe("High");
    expect(recorded.verifiedPrice).toBe("THB 5,000,000");
    expect(recorded.image).toBe("https://cdn.example.com/recorded.jpg");
  });
});

describe("ProjectService quarantine of known-fictitious slugs", () => {
  it("getBySlug refuses a known-fictitious slug without querying", async () => {
    listPartnerDemoProperties.mockClear();
    for (const slug of KNOWN_FICTITIOUS_PROJECT_SLUGS) {
      await expect(ProjectService.getBySlug(slug)).resolves.toBeNull();
    }
    expect(from).not.toHaveBeenCalled();
    expect(listPartnerDemoProperties).not.toHaveBeenCalled();
  });

  it("listActiveSlugs excludes known-fictitious slugs from sitemap enumeration", async () => {
    stubQueryResult({
      data: [{ slug: "modeva" }, ...KNOWN_FICTITIOUS_PROJECT_SLUGS.map((slug) => ({ slug }))],
      error: null,
    });

    await expect(ProjectService.listActiveSlugs()).resolves.toEqual(["modeva"]);
  });
});
