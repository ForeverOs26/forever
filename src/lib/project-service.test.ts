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

function projectRow(slug: string) {
  return {
    slug,
    name: slug,
    developer: { name: "Developer" },
    media: [],
    is_active: true,
    is_featured: false,
    created_at: "2026-01-01",
    project_type: "Villa",
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

beforeEach(() => {
  vi.stubEnv("VITE_PARTNER_DEMO", "false");
  from.mockClear();
  const result = { data: [projectRow("modeva"), projectRow("other")], error: null };
  const query: Record<string, unknown> = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
  };
  (query.select as ReturnType<typeof vi.fn>).mockReturnValue(query);
  (query.eq as ReturnType<typeof vi.fn>).mockReturnValue(query);
  (query.order as ReturnType<typeof vi.fn>).mockReturnValue(query);
  query.then = Promise.resolve(result).then.bind(Promise.resolve(result));
  from.mockReturnValue(query);
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
});
