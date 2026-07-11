import type { AuditFields, ForeverId, GeoPoint, Slug, SourceMetadata } from "./common";

/**
 * Location — standardized project geography and market context.
 *
 * Mirrors section 3 of the Forever Data Standard. Arrays default to `[]`
 * (an empty list is a known-empty fact, not a missing one); scalar optional
 * fields are omitted when absent.
 */
export interface ForeverLocation extends AuditFields {
  id: ForeverId;
  slug: Slug;
  areaName: string;
  country?: string;
  province?: string;
  district?: string;
  geo?: GeoPoint;
  description?: string;
  marketSummary?: string;
  lifestyleSummary?: string;
  distanceToBeach?: string;
  distanceToAirport?: string;
  nearbySchools: string[];
  nearbyHospitals: string[];
  lifestyle: string[];
  source?: SourceMetadata;
}
