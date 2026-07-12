/**
 * Forever Project Readiness — the examination context.
 *
 * A {@link ReadinessContext} is the per-examination configuration threaded
 * through the foundation when a caller wants to describe (never run) one
 * readiness examination: the RC4.4 registered sources, the RC4.6 canonical
 * record, and the RC4.7 cross-source validation report the caller has in
 * hand — every one of them the reused shape, never a parallel catalogue —
 * plus the reused behavioural policy and the clock (`now`) supplied by the
 * caller so the foundation stays deterministic: identical inputs and context
 * always produce identical output. No ambient clock read, no ambient locale.
 *
 * Every part is optional, and absence is preserved rather than papered over:
 * a statement whose judging input is absent settles into an explicit
 * `indeterminate` verdict — an absent record proves neither presence nor
 * absence, an absent report corroborates nothing and contests nothing, and
 * an absent source roster neither provides nor withholds a document. It
 * mirrors the Forever Import (RC3.1) `ImportContext`, Forever Sync (RC3.2)
 * `SyncContext`, Forever Pipeline (RC3.5) `PipelineContext`, Forever Project
 * Integration (RC4.0) `ProjectIntegrationContext`, Forever Extraction
 * Pipeline (RC4.5) `ExtractionContext`, Forever Canonical Project Database
 * (RC4.6) `ProjectContext`, Forever Cross-Source Validation (RC4.7)
 * `CrossValidationContext`, and Forever Knowledge Graph (RC4.8)
 * `KnowledgeGraphContext` so the foundations thread per-run configuration
 * the same way.
 */

import type { CrossValidationReport } from "@/features/forever-cross-validation";
import type { ISODateTime } from "@/features/forever-database";
import type { ProjectRecord } from "@/features/forever-project-database";
import type { ProjectSourceDefinition } from "@/features/forever-project-sources";

import type { ReadinessPolicy } from "./policy";

/** Per-examination configuration for describing one readiness examination. */
export interface ReadinessContext {
  /**
   * The RC4.4 registered source definitions `source_present` statements are
   * judged against, reused directly. Absent when the caller has no registry
   * in hand — source statements are then explicitly `indeterminate`, never
   * judged against an invented roster.
   */
  sources?: ProjectSourceDefinition[];
  /**
   * The RC4.6 canonical record `field_present` and `field_confidence`
   * statements are judged against, reused directly. Absent when no canonical
   * record exists yet — field statements are then explicitly
   * `indeterminate`.
   */
  record?: ProjectRecord;
  /**
   * The RC4.7 cross-source validation report `field_corroborated`,
   * `field_uncontested`, and `findings_clear` statements are judged against,
   * reused directly. Absent when no examination was described — those
   * statements are then explicitly `indeterminate`.
   */
  report?: CrossValidationReport;
  /** The reused RC4.0 behavioural contract for a future runtime. */
  policy?: ReadinessPolicy;
  /** Deterministic timestamp for provenance; the foundation reads no wall clock. */
  now?: ISODateTime;
}
