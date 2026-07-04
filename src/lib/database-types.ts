/**
 * Forever real estate database types.
 *
 * These mirror the Supabase `public` schema (developers, projects, units,
 * project_media, investment_data, price_updates, locations) and are the
 * canonical types for the future admin panel and any Supabase-backed
 * reads/writes. The UI-facing `Property` model in `./data.ts` stays as
 * the presentation shape; a future adapter will map DB rows into it.
 */

export type UUID = string;
export type ISODateTime = string;
export type ISODate = string;

export type ProjectType =
  | "Villa"
  | "Residence"
  | "Condominium"
  | "Townhouse"
  | "Land";

export type ConstructionStatus =
  | "Planning"
  | "Pre-Launch"
  | "Under Construction"
  | "Nearing Completion"
  | "Ready"
  | "Sold Out";

export type OwnershipType = "Freehold" | "Leasehold" | "Company" | "Mixed";

export type UnitAvailabilityStatus =
  | "available"
  | "reserved"
  | "sold"
  | "off_market";

export type MediaType =
  | "gallery"
  | "floor_plan"
  | "brochure"
  | "video"
  | "document";

export interface Developer {
  id: UUID;
  name: string;
  description: string | null;
  website: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  logo_url: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface Project {
  id: UUID;
  developer_id: UUID | null;
  name: string;
  slug: string;
  project_type: ProjectType | string | null;
  location_area: string | null;
  address: string | null;
  short_description: string | null;
  full_description: string | null;
  construction_status: ConstructionStatus | string | null;
  completion_date: ISODate | null;
  ownership_type: OwnershipType | string | null;
  distance_to_beach: string | null;
  distance_to_airport: string | null;
  distance_to_school: string | null;
  facilities: string[];
  latitude: number | null;
  longitude: number | null;
  main_image_url: string | null;
  brochure_url: string | null;
  is_featured: boolean;
  is_active: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface Unit {
  id: UUID;
  project_id: UUID;
  unit_code: string | null;
  unit_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  size_sqm: number | null;
  floor: number | null;
  view_type: string | null;
  ownership_type: OwnershipType | string | null;
  base_price_thb: number | null;
  discounted_price_thb: number | null;
  price_per_sqm: number | null;
  availability_status: UnitAvailabilityStatus;
  payment_plan: string | null;
  furniture_package: string | null;
  rental_guarantee: string | null;
  roi_estimate: string | null;
  notes: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface ProjectMedia {
  id: UUID;
  project_id: UUID;
  media_type: MediaType | string;
  title: string | null;
  url: string;
  sort_order: number;
  created_at: ISODateTime;
}

export interface InvestmentData {
  id: UUID;
  project_id: UUID | null;
  unit_id: UUID | null;
  expected_daily_rate: number | null;
  expected_monthly_rent: number | null;
  expected_yearly_rent: number | null;
  occupancy_rate: number | null;
  annual_roi_percent: number | null;
  guaranteed_rental_percent: number | null;
  guarantee_years: number | null;
  management_company: string | null;
  notes: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface PriceUpdate {
  id: UUID;
  project_id: UUID | null;
  unit_id: UUID | null;
  old_price_thb: number | null;
  new_price_thb: number | null;
  update_reason: string | null;
  source_file_url: string | null;
  updated_by: string | null;
  created_at: ISODateTime;
}

export type LeadStatus = "new" | "contacted" | "qualified" | "closed" | "spam";

export interface Lead {
  id: UUID;
  created_at: ISODateTime;
  name: string;
  email: string;
  phone: string;
  country: string | null;
  budget: string | null;
  interest: string | null;
  project_slug: string | null;
  message: string | null;
  status: LeadStatus | string;
  source: string;
}

export interface Location {
  id: UUID;
  area_name: string;
  description: string | null;
  beach_name: string | null;
  lifestyle_type: string | null;
  investment_strength: number | null;
  family_score: number | null;
  rental_demand_score: number | null;
  notes: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/** Convenience aggregate for a fully hydrated project record. */
export interface ProjectWithRelations extends Project {
  developer: Developer | null;
  units: Unit[];
  media: ProjectMedia[];
  investment: InvestmentData[];
}
