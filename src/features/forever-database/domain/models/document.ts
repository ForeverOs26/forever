import type { AuditFields, ForeverId, SourceMetadata, VerificationStatus } from "./common";
import type { ForeverDocumentType } from "./enums";

/**
 * Document — project evidence and official source material.
 *
 * Mirrors section 7 of the Forever Data Standard. Documents are the evidence
 * counterpart to Media; a brochure or price list is a Document, a gallery
 * photo is Media.
 */
export interface ForeverDocument extends AuditFields {
  id: ForeverId;
  projectId: ForeverId;
  documentType: ForeverDocumentType;
  title: string;
  url: string;
  description?: string;
  label?: string;
  note?: string;
  fileExtension?: string;
  verificationStatus?: VerificationStatus;
  sortOrder: number;
  isPublic: boolean;
  source?: SourceMetadata;
}
