import type { AuditFields, ForeverId, Money, SourceMetadata } from "./common";

/**
 * Investment Information — capital value, return, and growth outlook.
 *
 * This entity owns every capital/return fact exactly once: investment value,
 * annual ROI, and capital-growth outlook. Rental-income facts live in the
 * Rental Information entity, so the two never duplicate a value.
 *
 * A record may be project-level (`unitId` omitted) or unit-specific.
 */
export interface ForeverInvestmentInformation extends AuditFields {
  id: ForeverId;
  projectId: ForeverId;
  unitId?: ForeverId;
  investmentValue?: Money;
  annualRoiPercent?: number;
  capitalGrowthEstimate?: string;
  source?: SourceMetadata;
}
