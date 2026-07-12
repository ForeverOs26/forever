/**
 * Forever Knowledge Graph — the description context.
 *
 * A {@link KnowledgeGraphContext} is the per-description configuration
 * threaded through the foundation when a caller wants to describe (never
 * run) one knowledge graph: the RC4.4 registered sources, the RC4.6
 * canonical record, the RC4.6 described merge, and the RC4.7 cross-source
 * validation report the caller has in hand — every one of them the reused
 * shape, never a parallel catalogue — plus the reused behavioural policy and
 * the clock (`now`) supplied by the caller so the foundation stays
 * deterministic: identical inputs and context always produce identical
 * output. No ambient clock read, no ambient locale.
 *
 * Every part is optional, and absence is preserved rather than papered over:
 * a graph described without a report carries claims whose standing is the
 * explicit `unverified` default, a graph without registered sources still
 * traces facts to the sources they name (reported as unregistered), and a
 * graph without a record simply grows no revision nodes. It mirrors the
 * Forever Import (RC3.1) `ImportContext`, Forever Sync (RC3.2) `SyncContext`,
 * Forever Pipeline (RC3.5) `PipelineContext`, Forever Project Integration
 * (RC4.0) `ProjectIntegrationContext`, Forever Extraction Pipeline (RC4.5)
 * `ExtractionContext`, Forever Canonical Project Database (RC4.6)
 * `ProjectContext`, and Forever Cross-Source Validation (RC4.7)
 * `CrossValidationContext` so the foundations thread per-run configuration
 * the same way.
 */

import type { CrossValidationReport } from "@/features/forever-cross-validation";
import type { ISODateTime } from "@/features/forever-database";
import type { ProjectMerge, ProjectRecord } from "@/features/forever-project-database";
import type { ProjectSourceDefinition } from "@/features/forever-project-sources";

import type { KnowledgeGraphPolicy } from "./policy";

/** Per-description configuration for describing one knowledge graph. */
export interface KnowledgeGraphContext {
  /**
   * The RC4.4 registered source definitions the graph's sources come from,
   * reused directly. Absent when the caller has no registry in hand — a
   * source a fact names is then represented as the fact's own statement and
   * reported as unregistered, never invented into a registration.
   */
  sources?: ProjectSourceDefinition[];
  /**
   * The RC4.6 canonical record whose fields, values, and revisions the graph
   * represents, reused directly. Absent when no canonical record exists yet.
   */
  record?: ProjectRecord;
  /**
   * The RC4.6 described merge whose unresolved conflicts the graph
   * represents, reused directly. Absent when no merge was described.
   */
  merge?: ProjectMerge;
  /**
   * The RC4.7 cross-source validation report whose findings and consensus
   * judgements ground the graph's standings, reused directly. Absent when no
   * examination was described — claims then stay explicitly `unverified`.
   */
  report?: CrossValidationReport;
  /** The reused RC4.0 behavioural contract for a future runtime. */
  policy?: KnowledgeGraphPolicy;
  /** Deterministic timestamp for provenance; the foundation reads no wall clock. */
  now?: ISODateTime;
}
