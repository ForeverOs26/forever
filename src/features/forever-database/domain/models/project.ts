import type { AuditFields, ForeverId, ISODate, Money, Slug, SourceMetadata } from "./common";
import type { ConstructionStatus, OwnershipType, ProjectPublicStatus, SalesStatus } from "./enums";

/** Canonical pricing summary carried on the project record. */
export interface ForeverProjectPricing {
  startingPrice?: Money;
  priceRangeLabel?: string;
  pricePerSqmLabel?: string;
  verifiedPriceLabel?: string;
  promotion?: string;
  lastPriceUpdate?: ISODate | string;
}

/** Forever trust/verification summary carried on the project record. */
export interface ForeverProjectTrust {
  foreverVerified: boolean;
  trustScore?: number;
  trustNote?: string;
  marketPosition?: string;
  verdict?: string;
  lastInspectionDate?: string;
}

/**
 * The original free-text status values preserved verbatim from the source.
 *
 * Keeping the raw strings alongside the normalized enums guarantees no data
 * loss and lets any consumer that still relies on the original wording keep
 * working — this is the core of RC3.0 backward compatibility.
 */
export interface ForeverProjectRawStatus {
  publicStatus: string;
  salesStatus: string;
  constructionStatus: string;
  ownershipType: string;
}

/**
 * Project — the canonical parent record for every property project.
 *
 * Mirrors section 1 of the Forever Data Standard. Relationships to Developer
 * and Location are expressed by id so the entities stay normalized and
 * non-duplicated.
 */
export interface ForeverProject extends AuditFields {
  id: ForeverId;
  slug: Slug;
  name: string;
  developerId?: ForeverId;
  locationId?: ForeverId;
  projectType: string;
  publicStatus: ProjectPublicStatus;
  salesStatus: SalesStatus;
  constructionStatus: ConstructionStatus;
  ownershipType: OwnershipType;
  /** Original source status strings, preserved for backward compatibility. */
  raw: ForeverProjectRawStatus;
  country?: string;
  province?: string;
  area?: string;
  address?: string;
  code?: string;
  tagline?: string;
  shortDescription?: string;
  fullDescription?: string;
  completionDate?: ISODate | string;
  highlights: string[];
  bedsLabel?: string;
  areaLabel?: string;
  mainImageUrl?: string;
  brochureUrl?: string;
  pricing: ForeverProjectPricing;
  trust: ForeverProjectTrust;
  isFeatured: boolean;
  isActive: boolean;
  source?: SourceMetadata;
}
