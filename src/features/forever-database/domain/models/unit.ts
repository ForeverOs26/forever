import type { AuditFields, ForeverId, Money, SourceMetadata } from "./common";
import type { OwnershipType, UnitAvailabilityStatus } from "./enums";

/**
 * Unit — an individual saleable or referenceable inventory record.
 *
 * Mirrors section 5 of the Forever Data Standard. `availabilityStatus` and
 * `ownershipType` are normalized enums; the `*Raw` companions preserve the
 * original source wording for backward compatibility.
 */
export interface ForeverUnit extends AuditFields {
  id: ForeverId;
  projectId: ForeverId;
  buildingId?: ForeverId;
  code: string;
  unitType: string;
  availabilityStatus: UnitAvailabilityStatus;
  availabilityStatusRaw: string;
  ownershipType: OwnershipType;
  ownershipTypeRaw: string;
  bedrooms?: number;
  bathrooms?: number;
  sizeSqm?: number;
  floor?: number;
  viewType?: string;
  basePrice?: Money;
  discountedPrice?: Money;
  pricePerSqm?: number;
  paymentPlanLabel?: string;
  furniturePackage?: string;
  rentalGuarantee?: string;
  roiEstimate?: string;
  notes?: string;
  source?: SourceMetadata;
}
