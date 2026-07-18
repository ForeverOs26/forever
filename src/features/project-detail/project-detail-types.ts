import type { Database } from "@/integrations/supabase/types";

export type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
export type DeveloperRow = Database["public"]["Tables"]["developers"]["Row"];
export type ProjectMediaRow = Database["public"]["Tables"]["project_media"]["Row"];
export type UnitRow = Database["public"]["Tables"]["units"]["Row"];
export type InvestmentDataRow = Database["public"]["Tables"]["investment_data"]["Row"];

/**
 * Progressive-ingestion columns on `projects`. Hand-maintained until the
 * generated Database types are refreshed after the progressive-ingestion
 * migration is applied; optional so pre-migration rows keep working.
 */
export type ProgressiveProjectColumns = {
  developer_name_raw?: string | null;
  location_name_raw?: string | null;
  field_provenance?: Record<string, unknown> | null;
};

export type ProjectDetailRecord = ProjectRow &
  ProgressiveProjectColumns & {
    developer: DeveloperRow | null;
    media: ProjectMediaRow[] | null;
    units: UnitRow[] | null;
    investment: InvestmentDataRow[] | null;
  };

export type ProjectDetailMediaType =
  | "cover"
  | "gallery"
  | "floor_plan"
  | "master_plan"
  | "unit_plan"
  | "brochure"
  | "price_list"
  | "payment_plan"
  | "video"
  | "document"
  | string;

export type ProjectDetailMediaItem = {
  id: string;
  type: ProjectDetailMediaType;
  title: string;
  url: string;
  sortOrder: number;
};

export type ProjectDetailDocument = ProjectDetailMediaItem & {
  label: string;
  note: string;
};

export type ProjectDetailCore = {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  constructionStatus: string;
  ownershipType: string;
  location: string;
  address: string;
  tagline: string;
  description: string;
  highlights: string[];
  beds: string;
  area: string;
  isFeatured: boolean;
  isActive: boolean;
  /** A local/demo-only record, never a published project. */
  isDemoPreview?: boolean;
  /**
   * Raw source names shown as unverified fallbacks when no canonical link
   * exists. Optional so existing adapters/fixtures that predate progressive
   * ingestion keep compiling; the database mapper always sets them.
   */
  developerNameRaw?: string;
  locationNameRaw?: string;
};

export type ProjectDetailPricing = {
  startingPriceTHB: number;
  displayPrice: string;
  priceRange: string;
  pricePerSqm: string;
  verifiedPrice: string;
  promotion: string;
  lastPriceUpdate: string;
};

export type ProjectDetailTrust = {
  foreverVerified: boolean;
  trustScore: number;
  trustNote: string;
  marketPosition: string;
  verdict: string;
  lastInspection: string;
};

export type ProjectDetailInvestment = {
  investmentValue: number;
  rentalYield: string;
  rentalDemand: string;
  capitalGrowthEstimate: string;
  rows: ProjectDetailInvestmentRow[];
};

export type ProjectDetailLocation = {
  area: string;
  latitude: number | null;
  longitude: number | null;
  distanceToBeach: string;
  distanceToAirport: string;
  nearbySchools: string[];
  nearbyHospitals: string[];
  lifestyle: string[];
};

export type ProjectDetailDeveloper = {
  id: string;
  name: string;
  description: string;
  website: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  logoUrl: string;
} | null;

export type ProjectDetailMedia = {
  hero: ProjectDetailMediaItem | null;
  gallery: ProjectDetailMediaItem[];
  floorPlans: ProjectDetailMediaItem[];
  masterPlan: ProjectDetailMediaItem | null;
  unitPlans: ProjectDetailMediaItem[];
  brochures: ProjectDetailMediaItem[];
  videos: ProjectDetailMediaItem[];
  documents: ProjectDetailDocument[];
};

export type ProjectDetailUnit = {
  id: string;
  code: string;
  type: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sizeSqm: number | null;
  floor: number | null;
  viewType: string;
  ownershipType: string;
  basePriceTHB: number | null;
  discountedPriceTHB: number | null;
  pricePerSqm: number | null;
  availabilityStatus: string;
  paymentPlan: string;
  furniturePackage: string;
  rentalGuarantee: string;
  roiEstimate: string;
  notes: string;
};

export type ProjectDetailInvestmentRow = {
  id: string;
  projectId: string | null;
  unitId: string | null;
  expectedDailyRate: number | null;
  expectedMonthlyRent: number | null;
  expectedYearlyRent: number | null;
  occupancyRate: number | null;
  annualRoiPercent: number | null;
  guaranteedRentalPercent: number | null;
  guaranteeYears: number | null;
  managementCompany: string;
  notes: string;
};

export type ProjectDetail = {
  core: ProjectDetailCore;
  pricing: ProjectDetailPricing;
  trust: ProjectDetailTrust;
  investment: ProjectDetailInvestment;
  location: ProjectDetailLocation;
  developer: ProjectDetailDeveloper;
  media: ProjectDetailMedia;
  units: ProjectDetailUnit[];
};
