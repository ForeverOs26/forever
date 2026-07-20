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
 * (see `@/lib/project-service`). This file now only holds the shared
 * `Property` / `Project` types.
 *
 * FOREVER-TRUTH-001A removed the earlier static `offers`, `reviews`, and
 * `areas` content: the offers and reviews were fabricated (invented
 * promotions and testimonials with invented inventory counts), and the area
 * descriptions carried unverifiable factual and qualitative claims (travel
 * times, schools, resorts, residence patterns) with no source model behind
 * them. Evidence-dependent content must come from real, source-backed
 * records or not appear at all.
 */
