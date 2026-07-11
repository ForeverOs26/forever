/**
 * Forever Pipeline — run context.
 *
 * A {@link PipelineContext} is the per-run configuration threaded through the
 * foundation when a caller wants to describe (never execute) one planned run of
 * a pipeline. The clock (`now`) is supplied by the caller so the foundation
 * stays deterministic: identical inputs and context always produce identical
 * output. No `Date.now()`, no ambient locale.
 *
 * It mirrors the Forever Import (RC3.1) `ImportContext` and Forever Sync (RC3.2)
 * `SyncContext` so the three foundations thread per-run configuration the same
 * way.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { PipelineDefinition } from "./definition";

/** Per-run configuration for describing one planned pipeline run. */
export interface PipelineContext {
  definition: PipelineDefinition;
  /** Deterministic timestamp for provenance; the foundation reads no wall clock. */
  now?: ISODateTime;
}
