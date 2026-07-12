/**
 * Forever Extraction Pipeline — extraction context.
 *
 * An {@link ExtractionContext} is the per-attempt configuration threaded
 * through the foundation when a caller wants to describe (never execute) one
 * planned extraction. The clock (`now`) is supplied by the caller so the
 * foundation stays deterministic: identical inputs and context always produce
 * identical output. No ambient clock read, no ambient locale.
 *
 * It mirrors the Forever Import (RC3.1) `ImportContext`, the Forever Sync
 * (RC3.2) `SyncContext`, the Forever Pipeline (RC3.5) `PipelineContext`, the
 * Forever Project Integration (RC4.0) `ProjectIntegrationContext`, and the
 * Forever Project Factory (RC4.3) `FactoryContext` so the foundations thread
 * per-run configuration the same way.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ExtractionDefinition } from "./definition";

/** Per-attempt configuration for describing one planned extraction. */
export interface ExtractionContext {
  definition: ExtractionDefinition;
  /** Deterministic timestamp for provenance; the foundation reads no wall clock. */
  now?: ISODateTime;
}
