/**
 * Unified Property model.
 *
 * Single source of truth used across Discovery, Project Cards, Property Detail,
 * Compare, future CMS and Supabase. UI-facing string fields (price, beds, area,
 * location, image, verifiedPrice, promotion, lastInspection, distanceToBeach)
 * are preserved for backward compatibility with existing components.
 */

export type PropertyType = "Villa" | "Residence" | "Condominium" | "Not available";

export type ConstructionStatus =
  | "Planning"
  | "Pre-Launch"
  | "Under Construction"
  | "Nearing Completion"
  | "Ready"
  | "Sold Out"
  | "Not available";

export type SalesStatus = "Available" | "Selling" | "Sold Out" | "Not available";

export type MarketPosition =
  | "Below market"
  | "In line with market"
  | "Slight premium"
  | "Not available";

export type RentalDemand = "Low" | "Moderate" | "High" | "Very High" | "Not available";

export type ForeverVerdict =
  | "Strong Buy"
  | "Excellent Long-Term Investment"
  | "Ideal Family Residence"
  | "Lifestyle Purchase"
  | "Wait for Better Pricing"
  | "Not available";

export type Property = {
  // Core Information
  slug: string;
  name: string;
  developer: string;
  location: string; // area / neighborhood (display)
  propertyType: PropertyType;
  constructionStatus: ConstructionStatus;
  status: SalesStatus;
  tagline: string;
  description: string;
  highlights: string[];
  beds: string;
  area: string; // built area / sqm range (kept name for UI compat)

  // Pricing
  price: string; // display starting price (kept)
  startingPriceTHB: number;
  priceRange: string;
  pricePerSqm: string;
  lastPriceUpdate: string;
  verifiedPrice: string; // kept
  promotion: string; // kept

  // Forever Advisory
  foreverVerified: boolean;
  trustScore: number; // 0 – 10 (kept)
  trustNote: string;
  investmentValue: number; // 0 – 10
  marketPosition: MarketPosition;
  verdict: ForeverVerdict;

  // Location
  distanceToBeach: string; // kept
  distanceToAirport: string;
  nearbySchools: string[];
  nearbyHospitals: string[];
  lifestyle: string[];

  // Investment
  rentalYield: string;
  rentalDemand: RentalDemand;
  capitalGrowthEstimate: string;

  // Construction
  startDate: string;
  completionDate: string;
  lastInspection: string; // kept

  // Media
  image: string; // primary cover (kept)
  gallery: string[];
  floorPlans: string[];
  brochures: string[];
  videos: string[];
  /** Optional: master plan PDF URL, when available. */
  masterPlan?: string;
  /** Optional: consolidated unit plan PDF URL. */
  unitPlanPdf?: string;
  /** Optional: price list PDF URL. */
  priceList?: string;
};

/** Backward-compatible alias. Prefer `Property` in new code. */
export type Project = Property;

/**
 * Project data is loaded from Supabase via `ProjectService`
 * (see `@/lib/project-service`). This file now only holds:
 *   • the shared `Property` / `Project` types
 *   • the editorial Phuket area guide (geographic orientation only)
 *
 * FOREVER-TRUTH-001A removed the earlier static `offers` and `reviews`
 * arrays and the per-area `listings` counts: they were fabricated content
 * (invented promotions, invented testimonials, invented inventory counts)
 * and the public product is fail-closed — evidence-dependent content must
 * come from real, source-backed records or not appear at all.
 */

export type Area = {
  slug: string;
  name: string;
  region: string;
  description: string;
};

/**
 * Editorial area orientation. Descriptions are limited to geography and
 * character; they must not claim inventory counts, yields, returns, or any
 * project-level fact.
 */
export const areas: Area[] = [
  {
    slug: "surin",
    name: "Surin",
    region: "West Coast",
    description:
      "Quiet luxury above one of Phuket's most sheltered beaches. Sunset-facing villas and boutique residences.",
  },
  {
    slug: "kamala",
    name: "Kamala",
    region: "West Coast",
    description:
      "Beachfront condominiums and hillside villas, ten minutes from Patong but a world away in tempo.",
  },
  {
    slug: "layan-bangtao",
    name: "Layan & Bang Tao",
    region: "Laguna Corridor",
    description:
      "Phuket's most established luxury enclave — a long beachfront corridor with international schools and branded resorts.",
  },
  {
    slug: "kata-karon",
    name: "Kata & Karon",
    region: "South West",
    description:
      "Family-friendly bays with cliffside residences overhead and a walkable beach-town rhythm.",
  },
  {
    slug: "rawai-nai-harn",
    name: "Rawai & Nai Harn",
    region: "South Cape",
    description:
      "The southern cape — quieter, more local, favored by long-stay residents and yachting families.",
  },
  {
    slug: "cape-yamu",
    name: "Cape Yamu",
    region: "East Coast",
    description:
      "Sunrise-facing estates on Phuket's calm east coast, with deep-water access and Phang Nga Bay views.",
  },
];
