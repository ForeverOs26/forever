/**
 * Forever Pipeline — pipeline metadata.
 *
 * A {@link PipelineMetadata} carries the optional, descriptive facts about a
 * pipeline definition — who owns it, where it is documented, how to reach its
 * owner, which region it covers. Every field is optional and additive: a fact
 * that is not known is omitted, never coerced to a placeholder
 * (anti-fabrication). Timestamps are supplied by the caller so a description
 * stays deterministic — RC3.5 reads no wall clock.
 *
 * This is metadata *about a pipeline definition*; it is distinct from the
 * {@link import("./types").PipelineRunMetadata} that records the provenance of a
 * single planned run, and from the RC3.0 `SourceMetadata` that records the
 * provenance of a single imported fact. The three live apart and are never
 * conflated.
 */

import type { ISODateTime } from "@/features/forever-database";

/** Optional descriptive facts about a pipeline. All fields are additive. */
export interface PipelineMetadata {
  /** Free-text description of the pipeline. */
  description?: string;
  /** Team or person responsible for the pipeline. */
  owner?: string;
  /** Link to human documentation for the pipeline. Stored, never fetched. */
  documentationUrl?: string;
  /** Contact handle for the pipeline's owner. */
  contact?: string;
  /** Region the pipeline's data covers, e.g. `Phuket`. */
  region?: string;
  /** Free-form tags for grouping and search. */
  tags?: string[];
  /** When the pipeline was first described, supplied by the caller. */
  addedAt?: ISODateTime;
  /** When the description was last revised, supplied by the caller. */
  updatedAt?: ISODateTime;
}
