/**
 * Forever Project Integration (RC4.0) — shared primitive types.
 *
 * These are the orchestration-agnostic building blocks every descriptor in the
 * project-integration foundation is composed from. RC4.0 is the first
 * *integration* layer of Forever: it ties the existing foundations together
 * (the Forever Database RC3.0 identity, the Forever Import RC3.1 entity taxonomy
 * and severity vocabulary, the Forever Sync RC3.2 systems and directions, the
 * Forever Source Registry RC3.3 sources, the Forever Connectors RC3.4
 * connectors, and the Forever Pipeline RC3.5 pipelines) into one declarative
 * description of how a whole project is brought into Forever end-to-end.
 *
 * It is architecture only. It moves no data, runs no stage, opens no
 * connection, reads no clock, and holds no credential — it *describes* what an
 * integration would do, never an integration itself. The types deliberately
 * reuse the neighbouring foundations so an integration speaks the exact language
 * the rest of Forever already consumes, and never restates identity or a parallel
 * taxonomy.
 */

import type { ForeverId, ISODateTime } from "@/features/forever-database";
import type { ImportSeverity, ImportSourceKind } from "@/features/forever-import";

import type { ProjectIntegrationOutcome, ProjectIntegrationState } from "./state";

/** Stable identifier for a project integration. Reuses the RC3.0 id type. */
export type ProjectIntegrationId = ForeverId;

/**
 * The canonical entity kinds an integration handles.
 *
 * Reuses the Forever Import (RC3.1) kinds verbatim so an integrated entity is
 * exactly an imported entity — no parallel taxonomy to drift out of sync.
 */
export type ProjectIntegrationEntityKind = ImportSourceKind;

/**
 * Whether an issue blocks an integration from being registered (`error`) or
 * merely annotates it (`warning`). Reuses the RC3.1 severity vocabulary so an
 * integration issue partitions by the same rule an import, sync, source,
 * connector, or pipeline issue does.
 */
export type ProjectIntegrationSeverity = ImportSeverity;

/**
 * A single structured issue raised while describing or validating an
 * integration.
 *
 * Issues are never thrown — the foundation returns them so callers decide how to
 * react. `path` is a dotted locator into the offending structure, e.g.
 * `stages.0.steps.1.dependsOn.0`.
 */
export interface ProjectIntegrationIssue {
  code: string;
  message: string;
  path?: string;
  severity: ProjectIntegrationSeverity;
}

/** A non-blocking issue: the integration can still be registered. */
export interface ProjectIntegrationWarning extends ProjectIntegrationIssue {
  severity: "warning";
}

/** A blocking issue: the integration must not be registered as-is. */
export interface ProjectIntegrationError extends ProjectIntegrationIssue {
  severity: "error";
}

/**
 * Deterministic counters describing what a planned integration run would touch.
 *
 * RC4.0 runs nothing, so these are the shape a future runtime would fill in; the
 * foundation only ever assembles a zeroed or caller-supplied set and derives a
 * {@link ProjectIntegrationState}/{@link ProjectIntegrationOutcome} from them.
 */
export interface ProjectIntegrationStats {
  /** Stages considered by the run. */
  stages: number;
  /** Steps considered across every stage. */
  steps: number;
  /** Steps that would run to completion. */
  completed: number;
  /** Steps intentionally skipped (e.g. an optional step whose input was absent). */
  skipped: number;
  /** Steps dropped because they raised a blocking error. */
  failed: number;
  warnings: number;
  errors: number;
}

/**
 * Provenance attached to the output of one integration run.
 *
 * `stageCount`/`stepCount`/`entityCount` mirror the definition so a caller can
 * read the headline facts without re-deriving them. `plannedAt` is set from
 * {@link import("./context").ProjectIntegrationContext.now} when present; the
 * foundation reads no wall clock.
 */
export interface ProjectIntegrationRunMetadata {
  integrationId: ProjectIntegrationId;
  /** Deterministic timestamp for provenance; supplied by the caller. */
  plannedAt?: ISODateTime;
  stageCount: number;
  stepCount: number;
  entityCount: number;
}

/**
 * The result of planning one integration run.
 *
 * Generic over the canonical entity type the integration would produce. `ok` is
 * `true` only when no blocking {@link ProjectIntegrationError} was raised; `data`
 * then holds the records the run would carry forward. `state` and `outcome` are
 * derived deterministically from the stats so they can never disagree with the
 * counters.
 */
export interface ProjectIntegrationResult<T> {
  ok: boolean;
  state: ProjectIntegrationState;
  outcome: ProjectIntegrationOutcome;
  data: T[];
  errors: ProjectIntegrationError[];
  warnings: ProjectIntegrationWarning[];
  stats: ProjectIntegrationStats;
  metadata: ProjectIntegrationRunMetadata;
}
