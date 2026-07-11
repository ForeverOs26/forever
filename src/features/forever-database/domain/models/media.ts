import type { AuditFields, ForeverId, SourceMetadata } from "./common";
import type { ForeverMediaType } from "./enums";

/**
 * Media — visual and video assets used across Forever interfaces.
 *
 * Mirrors section 8 of the Forever Data Standard. Media is kept distinct from
 * Documents: images and videos live here; source/evidence files live in the
 * Documents entity. Each asset belongs to exactly one project.
 */
export interface ForeverMedia extends AuditFields {
  id: ForeverId;
  projectId: ForeverId;
  mediaType: ForeverMediaType;
  title: string;
  url: string;
  altText?: string;
  caption?: string;
  sortOrder: number;
  isPublic: boolean;
  source?: SourceMetadata;
}
