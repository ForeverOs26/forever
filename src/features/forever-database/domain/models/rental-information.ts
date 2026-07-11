import type { AuditFields, ForeverId, Money, SourceMetadata } from "./common";

/**
 * Rental Information — expected rental income and demand.
 *
 * This entity owns every rental-income fact exactly once: expected rents,
 * occupancy, rental guarantees, and demand signals. Capital/ROI facts live in
 * the Investment Information entity, so the two never duplicate a value.
 *
 * A record may be project-level (`unitId` omitted) or unit-specific.
 */
export interface ForeverRentalInformation extends AuditFields {
  id: ForeverId;
  projectId: ForeverId;
  unitId?: ForeverId;
  expectedDailyRate?: Money;
  expectedMonthlyRent?: Money;
  expectedYearlyRent?: Money;
  /** Occupancy percentage in the range 0..100. */
  occupancyRatePercent?: number;
  guaranteedRentalPercent?: number;
  guaranteeYears?: number;
  managementCompany?: string;
  rentalYieldLabel?: string;
  rentalDemand?: string;
  notes?: string;
  source?: SourceMetadata;
}
