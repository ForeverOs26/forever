/**
 * Forever Project Factory — build context.
 *
 * A {@link FactoryContext} is the per-build configuration threaded through the
 * foundation when a caller wants to describe (never execute) one planned build.
 * The clock (`now`) is supplied by the caller so the foundation stays
 * deterministic: identical inputs and context always produce identical output.
 * No `Date.now()`, no ambient locale.
 *
 * It mirrors the Forever Import (RC3.1) `ImportContext`, the Forever Sync
 * (RC3.2) `SyncContext`, the Forever Pipeline (RC3.5) `PipelineContext`, and
 * the Forever Project Integration (RC4.0) `ProjectIntegrationContext` so the
 * foundations thread per-run configuration the same way.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { FactoryDefinition } from "./definition";

/** Per-build configuration for describing one planned factory build. */
export interface FactoryContext {
  definition: FactoryDefinition;
  /** Deterministic timestamp for provenance; the foundation reads no wall clock. */
  now?: ISODateTime;
}
