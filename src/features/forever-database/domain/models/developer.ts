import type {
  AuditFields,
  ForeverId,
  ISODate,
  Slug,
  SourceMetadata,
  VerificationStatus,
} from "./common";

/**
 * Developer — the organization responsible for a project.
 *
 * Mirrors section 2 of the Forever Data Standard. `name`, `slug` are required
 * identity; everything else is optional and omitted when absent.
 */
export interface ForeverDeveloper extends AuditFields {
  id: ForeverId;
  slug: Slug;
  name: string;
  country?: string;
  legalName?: string;
  description?: string;
  website?: string;
  logoUrl?: string;
  headquarters?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  verificationStatus: VerificationStatus;
  lastVerifiedDate?: ISODate;
  notes?: string;
  source?: SourceMetadata;
}
