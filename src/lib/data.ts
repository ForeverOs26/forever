/**
 * Unified Property model.
 *
 * Single source of truth used across Discovery, Project Cards, Property Detail,
 * Compare, future CMS and Supabase. UI-facing string fields (price, beds, area,
 * location, image, verifiedPrice, promotion, lastInspection, distanceToBeach)
 * are preserved for backward compatibility with existing components.
 */

export type PropertyType = "Villa" | "Residence" | "Condominium";

export type ConstructionStatus =
  | "Planning"
  | "Pre-Launch"
  | "Under Construction"
  | "Nearing Completion"
  | "Ready"
  | "Sold Out";

export type SalesStatus = "Available" | "Selling" | "Sold Out";

export type MarketPosition = "Below market" | "In line with market" | "Slight premium";

export type RentalDemand = "Low" | "Moderate" | "High" | "Very High";

export type ForeverVerdict =
  | "Strong Buy"
  | "Excellent Long-Term Investment"
  | "Ideal Family Residence"
  | "Lifestyle Purchase"
  | "Wait for Better Pricing";

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
 *   • the static content sections that are not yet in the CMS
 *     (offers, reviews, areas)
 */

export type Offer = {
  id: string;
  title: string;
  project: string;
  detail: string;
  expires: string;
  savings: string;
};

export const offers: Offer[] = [
  {
    id: "surin-furniture",
    title: "Furniture Package Included",
    project: "Surin Ridge Villas",
    detail: "Verified Offer: reserve any villa this quarter and the full designer furniture package is included at handover.",
    expires: "September 30",
    savings: "Value ฿3.2M",
  },
  {
    id: "kamala-transfer",
    title: "Transfer Fee Waived",
    project: "Kamala Beach Residences",
    detail: "Verified Offer: developer covers the 2% transfer fee on any 2-bedroom unit reserved before end of quarter.",
    expires: "August 15",
    savings: "Save up to ฿760,000",
  },
  {
    id: "layan-prelaunch",
    title: "Pre-Launch 5% Discount",
    project: "Layan Forest Villas",
    detail: "Verified Offer: pre-launch discount held for the first twelve buyers in this ridge release.",
    expires: "July 20",
    savings: "Save ฿3.1M",
  },
  {
    id: "bangtao-rental",
    title: "1-Year Rental Management",
    project: "Bang Tao Garden Villas",
    detail: "Verified Offer: complimentary first-year rental management with owner-friendly terms.",
    expires: "October 1",
    savings: "Value ฿240,000",
  },
];

export type Review = {
  id: string;
  name: string;
  role: string;
  project: string;
  rating: number;
  quote: string;
};

export const reviews: Review[] = [
  {
    id: "r1",
    name: "Priya & Marcus Chen",
    role: "Homeowners",
    project: "Surin Ridge Villas",
    rating: 5,
    quote:
      "Forever inspected the site with us, flagged two structural concerns the developer fixed before signing, and stayed with us through handover.",
  },
  {
    id: "r2",
    name: "Alina Fischer",
    role: "Homeowner",
    project: "Kamala Beach Residences",
    rating: 5,
    quote:
      "An advisor who told us which units to skip and why. We paid the verified price, not the brochure price.",
  },
  {
    id: "r3",
    name: "The Okafor Family",
    role: "Homeowners",
    project: "Layan Forest Villas",
    rating: 5,
    quote:
      "They visit the site every month. When our villa's ceiling detail drifted from the drawings, Forever caught it — not us.",
  },
  {
    id: "r4",
    name: "Julien Marceau",
    role: "Investor",
    project: "Bang Tao Garden Villas",
    rating: 4,
    quote:
      "Independent yield analysis, no upselling. They talked me out of a shinier project and into a better return.",
  },
  {
    id: "r5",
    name: "Sofia Delacroix",
    role: "Homeowner",
    project: "Kata Cliff Residences",
    rating: 5,
    quote:
      "Legal, tax, handover, rental setup — one advisor, from first viewing to the first tenant.",
  },
];

export type Area = {
  slug: string;
  name: string;
  region: string;
  listings: number;
  description: string;
};

export const areas: Area[] = [
  {
    slug: "surin",
    name: "Surin",
    region: "West Coast",
    listings: 14,
    description: "Quiet luxury above one of Phuket's most sheltered beaches. Sunset-facing villas and boutique residences.",
  },
  {
    slug: "kamala",
    name: "Kamala",
    region: "West Coast",
    listings: 11,
    description: "Beachfront condominiums and hillside villas, ten minutes from Patong but a world away in tempo.",
  },
  {
    slug: "layan-bangtao",
    name: "Layan & Bang Tao",
    region: "Laguna Corridor",
    listings: 18,
    description: "Phuket's most established luxury enclave — 8 km of beach, international schools, and branded resorts.",
  },
  {
    slug: "kata-karon",
    name: "Kata & Karon",
    region: "South West",
    listings: 9,
    description: "Family-friendly bays with strong short-term rental yields and cliffside residences overhead.",
  },
  {
    slug: "rawai-nai-harn",
    name: "Rawai & Nai Harn",
    region: "South Cape",
    listings: 7,
    description: "The southern cape — quieter, more local, favored by long-stay owners and yachting families.",
  },
  {
    slug: "cape-yamu",
    name: "Cape Yamu",
    region: "East Coast",
    listings: 5,
    description: "Sunrise-facing estates on Phuket's calm east coast, with deep-water access and Phang Nga Bay views.",
  },
];
