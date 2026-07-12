/**
 * Forever Cross-Source Validation — the examination context.
 *
 * A {@link CrossValidationContext} is the per-description configuration
 * threaded through the foundation when a caller wants to describe (never
 * perform) one cross-source examination: the RC4.4 registered sources the
 * facts should trace to (reused definitions, never a parallel catalogue), the
 * caller's stated requirements, the reused behavioural policy, and the clock
 * (`now`) supplied by the caller so the foundation stays deterministic —
 * identical inputs and context always produce identical output. No ambient
 * clock read, no ambient locale.
 *
 * Every part is optional: an examination without registered sources still
 * describes what it can (readings resolve no authority — the absence is
 * preserved), and absent requirements demand nothing. It mirrors the Forever
 * Import (RC3.1) `ImportContext`, Forever Sync (RC3.2) `SyncContext`, Forever
 * Pipeline (RC3.5) `PipelineContext`, Forever Project Integration (RC4.0)
 * `ProjectIntegrationContext`, Forever Project Factory (RC4.3)
 * `FactoryContext`, Forever Extraction Pipeline (RC4.5) `ExtractionContext`,
 * and Forever Canonical Project Database (RC4.6) `ProjectContext` so the
 * foundations thread per-run configuration the same way.
 */

import type { ISODateTime } from "@/features/forever-database";
import type { ProjectSourceDefinition } from "@/features/forever-project-sources";

import type { CrossValidationPolicy } from "./policy";
import type { CrossValidationRequirements } from "./requirements";

/** Per-description configuration for describing one cross-source examination. */
export interface CrossValidationContext {
  /**
   * The RC4.4 registered source definitions the examined facts should trace
   * to, reused directly. Absent when the caller has no registry in hand — an
   * unregistered source is then simply unresolvable, never invented.
   */
  sources?: ProjectSourceDefinition[];
  /** The caller's stated bars and expectations; nothing is demanded by default. */
  requirements?: CrossValidationRequirements;
  /** The reused RC4.0 behavioural contract for a future runtime. */
  policy?: CrossValidationPolicy;
  /** Deterministic timestamp for provenance; the foundation reads no wall clock. */
  now?: ISODateTime;
}
