import type {
  ProjectDetail,
  ProjectDetailInvestmentRow,
  ProjectDetailUnit,
} from "@/features/project-detail/project-detail-types";

/**
 * Deterministic test fixtures for the Investment Intelligence derivation.
 *
 * `makeProject` builds a complete, minimal `ProjectDetail` (mirroring the
 * verified-but-sparse "Modeva" seed record) and applies shallow per-section
 * overrides. No randomness, no timestamps — identical calls are identical.
 */

export function makeUnit(overrides: Partial<ProjectDetailUnit> = {}): ProjectDetailUnit {
  return {
    id: "unit-1",
    code: "A-101",
    type: "Condominium",
    bedrooms: null,
    bathrooms: null,
    sizeSqm: null,
    floor: null,
    viewType: "",
    ownershipType: "Freehold",
    basePriceTHB: null,
    discountedPriceTHB: null,
    pricePerSqm: null,
    availabilityStatus: "available",
    paymentPlan: "",
    furniturePackage: "",
    rentalGuarantee: "",
    roiEstimate: "",
    notes: "",
    ...overrides,
  };
}

export function makeInvestmentRow(
  overrides: Partial<ProjectDetailInvestmentRow> = {},
): ProjectDetailInvestmentRow {
  return {
    id: "inv-1",
    projectId: "project-1",
    unitId: null,
    expectedDailyRate: null,
    expectedMonthlyRent: null,
    expectedYearlyRent: null,
    occupancyRate: null,
    annualRoiPercent: null,
    guaranteedRentalPercent: null,
    guaranteeYears: null,
    managementCompany: "",
    notes: "",
    ...overrides,
  };
}

type ProjectOverrides = {
  core?: Partial<ProjectDetail["core"]>;
  pricing?: Partial<ProjectDetail["pricing"]>;
  trust?: Partial<ProjectDetail["trust"]>;
  investment?: Partial<ProjectDetail["investment"]>;
  location?: Partial<ProjectDetail["location"]>;
  developer?: ProjectDetail["developer"];
  units?: ProjectDetailUnit[];
};

/** A verified-but-sparse project, matching the Modeva seed shape. */
export function makeProject(overrides: ProjectOverrides = {}): ProjectDetail {
  return {
    core: {
      id: "project-1",
      slug: "the-modeva-bang-tao",
      name: "Modeva",
      type: "Condominium",
      status: "Available",
      constructionStatus: "Planning",
      ownershipType: "Freehold",
      location: "Bang Tao",
      address: "Bang Tao, Phuket, Thailand",
      tagline: "",
      description: "",
      highlights: [],
      beds: "",
      area: "",
      isFeatured: true,
      isActive: true,
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
      foreverVerified: true,
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
      area: "Bang Tao",
      latitude: null,
      longitude: null,
      distanceToBeach: "",
      distanceToAirport: "",
      nearbySchools: [],
      nearbyHospitals: [],
      lifestyle: [],
      ...overrides.location,
    },
    developer:
      overrides.developer !== undefined
        ? overrides.developer
        : {
            id: "dev-1",
            name: "Title",
            description: "",
            website: "",
            contactName: "",
            contactPhone: "",
            contactEmail: "",
            logoUrl: "",
          },
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
    units: overrides.units ?? [],
  };
}
