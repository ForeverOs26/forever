/**
 * Forever Connectors — connector metadata.
 *
 * A {@link ConnectorMetadata} carries the optional, descriptive facts about a
 * connector — who owns it, where it is documented, how to reach its owner, which
 * region it covers. Every field is optional and additive: a fact that is not
 * known is omitted, never coerced to a placeholder (anti-fabrication).
 * Timestamps are supplied by the caller so a description stays deterministic —
 * RC3.4 reads no wall clock.
 *
 * This is metadata *about a connector definition*; it is distinct from the RC3.0
 * `SourceMetadata` that records the provenance of a single imported fact. The
 * two live in different modules and are never conflated.
 */

import type { ISODateTime } from "@/features/forever-database";

/** Optional descriptive facts about a connector. All fields are additive. */
export interface ConnectorMetadata {
  /** Free-text description of the connector. */
  description?: string;
  /** Team or person responsible for the connector. */
  owner?: string;
  /** Link to human documentation for the connector. Stored, never fetched. */
  documentationUrl?: string;
  /** Contact handle for the connector's owner. */
  contact?: string;
  /** Region the connector's system covers, e.g. `Phuket`. */
  region?: string;
  /** Free-form tags for grouping and search. */
  tags?: string[];
  /** When the connector was first described, supplied by the caller. */
  addedAt?: ISODateTime;
  /** When the description was last revised, supplied by the caller. */
  updatedAt?: ISODateTime;
}
