/**
 * Forever Project Integration — run context.
 *
 * A {@link ProjectIntegrationContext} is the per-run configuration threaded
 * through the foundation when a caller wants to describe (never execute) one
 * planned run of an integration. The clock (`now`) is supplied by the caller so
 * the foundation stays deterministic: identical inputs and context always
 * produce identical output. No `Date.now()`, no ambient locale.
 *
 * It mirrors the Forever Import (RC3.1) `ImportContext`, the Forever Sync (RC3.2)
 * `SyncContext`, and the Forever Pipeline (RC3.5) `PipelineContext` so the
 * foundations thread per-run configuration the same way.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ProjectIntegrationDefinition } from "./definition";

/** Per-run configuration for describing one planned integration run. */
export interface ProjectIntegrationContext {
  definition: ProjectIntegrationDefinition;
  /** Deterministic timestamp for provenance; the foundation reads no wall clock. */
  now?: ISODateTime;
}
