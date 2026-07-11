/**
 * Forever Source Registry — source metadata.
 *
 * A {@link SourceMetadata} carries the optional, descriptive facts about a
 * source — who owns it, where it is documented, how to reach it, which region
 * it covers. Every field is optional and additive: a fact that is not known is
 * omitted, never coerced to a placeholder (anti-fabrication). Timestamps are
 * supplied by the caller so a description stays deterministic — RC3.3 reads no
 * wall clock.
 *
 * This is metadata *about a source definition*; it is distinct from the RC3.0
 * `SourceMetadata` that records the provenance of a single imported fact. The
 * two live in different modules and are never conflated.
 */

import type { ISODateTime } from "@/features/forever-database";

/** Optional descriptive facts about a source. All fields are additive. */
export interface SourceMetadata {
  /** Free-text description of the source. */
  description?: string;
  /** Team or person responsible for the source. */
  owner?: string;
  /** Link to human documentation for the source. Stored, never fetched. */
  documentationUrl?: string;
  /** Contact handle for the source's owner. */
  contact?: string;
  /** Region the source's data covers, e.g. `Phuket`. */
  region?: string;
  /** Free-form tags for grouping and search. */
  tags?: string[];
  /** When the source was first described, supplied by the caller. */
  addedAt?: ISODateTime;
  /** When the description was last revised, supplied by the caller. */
  updatedAt?: ISODateTime;
}
