import type { Database } from "@/integrations/supabase/types";

export type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
export type DeveloperRow = Database["public"]["Tables"]["developers"]["Row"];
/**
 * `semantic_role` is now present in the generated Database types, so this
 * intersection no longer compensates for a lagging generator. It is kept
 * because it pins something the generator does not
 * (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001): the field is REQUIRED here, not
 * optional. An optional field would let a future edit drop the column from
 * `PROJECT_DETAIL_SELECT` and still compile, after which every row arrives with
 * the field `undefined`, every reader correctly answers "show it" — that is the
 * pre-backfill rollout guarantee — and the contract fails open with a green
 * suite. `public-query-contract.test.ts` pins the select string; this pins the
 * shape the mappers are written against.
 */
export type ProjectMediaRow = Database["public"]["Tables"]["project_media"]["Row"] & {
  semantic_role: string | null;
};
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

/**
 * A unit row plus its embedded building identity.
 *
 * Only `building_code` is embedded. `buildings.metadata` carries field
 * provenance — repository paths and source URLs — and is withheld from the
 * public role by `20260726140000_public_unit_price_projection.sql`, so it is
 * neither selected nor typed here.
 */
export type UnitRowWithBuilding = UnitRow & {
  building?: { building_code: string | null } | null;
};

/**
 * One row of the canonical amenities relation — `project_amenities` embedded
 * with its `amenities` parent — as the public projection returns it.
 *
 * The column set is exactly what the two tables hold. `project_amenities` is
 * `(project_id, amenity_id, note, is_featured, sort_order, created_at)` and
 * `amenities` is `(id, name, slug, category, icon, created_at, updated_at)`.
 *
 * `is_featured` and `sort_order` are the Owner's editorial choices, added by
 * `20260728160000_studio_project_amenities_editor.sql` and written only by
 * `studio_save_project_amenities`. Both are `NOT NULL` with a default in the
 * database, so a row that predates the Owner ever opening the editor reads as
 * `false` / `0` — unfeatured and unordered — rather than as a null the mapper
 * would have to interpret. They are typed nullable here anyway, because a
 * PostgREST embed of a row the policy hides yields nulls for every column.
 */
export type ProjectAmenityRow = {
  note?: string | null;
  is_featured?: boolean | null;
  sort_order?: number | null;
  amenity: {
    id: string | null;
    name: string | null;
    slug: string | null;
    category: string | null;
    icon: string | null;
  } | null;
};

export type ProjectDetailRecord = ProjectRow &
  ProgressiveProjectColumns & {
    developer: DeveloperRow | null;
    media: ProjectMediaRow[] | null;
    units: UnitRowWithBuilding[] | null;
    investment: InvestmentDataRow[] | null;
    amenities?: ProjectAmenityRow[] | null;
  };

/**
 * One amenity as the public page consumes it.
 *
 * Every text field is a plain string — absent values collapse to `""` rather
 * than `null`, so a renderer never has to distinguish "no category" from "null
 * category". Only `name` is guaranteed non-empty: a row without one is dropped
 * during mapping, because an amenity that cannot be named cannot be shown.
 *
 * `isFeatured` and `sortOrder` are the Owner's ordering, carried through from
 * the relation. They decide position only — a featured amenity is shown first,
 * not shown differently.
 */
export type ProjectAmenity = {
  id: string;
  slug: string;
  name: string;
  category: string;
  icon: string;
  note: string;
  isFeatured: boolean;
  sortOrder: number;
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
  /**
   * What the image depicts, from the fixed vocabulary in `hero-policy.ts`
   * (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001).
   *
   * `null` means no classification was recorded — either the row predates the
   * contract or the Factory formed no opinion. It is never a reason to hide an
   * image. Only a positively recognised, excluded role is.
   */
  semanticRole: string | null;
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
  /** Explicit building identifier when the source supplies one. */
  buildingCode?: string;
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
  /**
   * Amenities the project record states outright, from the canonical
   * `project_amenities` → `amenities` relation — and from nothing else
   * (finding F3).
   *
   * This is the ONLY input the "Facilities & Amenities" section may read. It
   * used to read `core.highlights`, which are editorial one-liners: Modeva's
   * three are "Forever Verified project record", "Bang Tao location" and
   * "Structured project foundation". Printed under a heading promising what
   * the project includes, those state three things the developer never said.
   *
   * The structured relation is kept, not flattened to `string[]`: the tables
   * already carry `slug`, `category`, `icon` and a per-project `note`, and
   * discarding them at the mapping boundary would mean re-querying to group or
   * annotate. A renderer that only wants names maps over `name`.
   *
   * It is empty for every public project today, because the relation holds
   * zero rows for all of them, so the section and its navigation entry are
   * absent everywhere. That is the correct current outcome, not a placeholder.
   */
  amenities: ProjectAmenity[];
};
