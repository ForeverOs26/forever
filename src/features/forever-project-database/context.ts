/**
 * Forever Canonical Project Database — the database context.
 *
 * A {@link ProjectContext} is the per-description configuration threaded
 * through the foundation when a caller wants to describe (never apply) one
 * merge of extracted facts into a canonical record. The clock (`now`) is
 * supplied by the caller so the foundation stays deterministic: identical
 * inputs and context always produce identical output. No ambient clock read,
 * no ambient locale.
 *
 * It mirrors the Forever Import (RC3.1) `ImportContext`, the Forever Sync
 * (RC3.2) `SyncContext`, the Forever Pipeline (RC3.5) `PipelineContext`, the
 * Forever Project Integration (RC4.0) `ProjectIntegrationContext`, the
 * Forever Project Factory (RC4.3) `FactoryContext`, and the Forever
 * Extraction Pipeline (RC4.5) `ExtractionContext` so the foundations thread
 * per-run configuration the same way.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ProjectRecord } from "./record";

/** Per-description configuration for describing one canonical merge. */
export interface ProjectContext {
  /** The existing canonical record incoming facts are described against. */
  record: ProjectRecord;
  /** Deterministic timestamp for provenance; the foundation reads no wall clock. */
  now?: ISODateTime;
}
