/**
 * Forever Pipeline (RC3.5) — shared primitive types.
 *
 * These are the orchestration-agnostic building blocks every descriptor in the
 * pipeline foundation is composed from. RC3.5 is the *foundation* every future
 * end-to-end data pipeline (acquire → import → transform → validate → sync →
 * publish) is *described* with — it moves no data, runs no stage, opens no
 * connection, reads no clock, and holds no credential.
 *
 * The types deliberately reuse the neighbouring foundations so a pipeline speaks
 * the exact language the rest of Forever already consumes: the canonical
 * entities a pipeline handles are the Forever Import (RC3.1) kinds, and an issue
 * raised while describing a pipeline shares the RC3.1 severity vocabulary.
 * Identity is anchored on the Forever Database (RC3.0) id type — never a parallel
 * scheme. Nothing here performs IO, HTTP, scheduling, execution, or persistence;
 * it is architecture only.
 */

import type { ForeverId, ISODateTime } from "@/features/forever-database";
import type { ImportSeverity, ImportSourceKind } from "@/features/forever-import";

import type { PipelineOutcome, PipelineState } from "./state";

/** Stable identifier for a pipeline. Reuses the RC3.0 id type. */
export type PipelineId = ForeverId;

/**
 * The canonical entity kinds a pipeline handles.
 *
 * Reuses the Forever Import (RC3.1) kinds verbatim so a pipelined entity is
 * exactly an imported entity — no parallel taxonomy to drift out of sync.
 */
export type PipelineEntityKind = ImportSourceKind;

/**
 * Whether an issue blocks a pipeline from being registered (`error`) or merely
 * annotates it (`warning`). Reuses the RC3.1 severity vocabulary so a pipeline
 * issue partitions by the same rule an import, sync, source, or connector issue
 * does.
 */
export type PipelineSeverity = ImportSeverity;

/**
 * A single structured issue raised while describing or validating a pipeline.
 *
 * Issues are never thrown — the foundation returns them so callers decide how to
 * react. `path` is a dotted locator into the offending structure, e.g.
 * `stages.0.steps.1.dependsOn.0`.
 */
export interface PipelineIssue {
  code: string;
  message: string;
  path?: string;
  severity: PipelineSeverity;
}

/** A non-blocking issue: the pipeline can still be registered. */
export interface PipelineWarning extends PipelineIssue {
  severity: "warning";
}

/** A blocking issue: the pipeline must not be registered as-is. */
export interface PipelineError extends PipelineIssue {
  severity: "error";
}

/**
 * Deterministic counters describing what a planned run would touch.
 *
 * RC3.5 runs nothing, so these are the shape a future runtime would fill in;
 * the foundation only ever assembles a zeroed or caller-supplied set and derives
 * a {@link PipelineState}/{@link PipelineOutcome} from them.
 */
export interface PipelineStats {
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
 * Provenance attached to the output of one pipeline run.
 *
 * `stageCount`/`stepCount`/`entityCount` mirror the definition so a caller can
 * read the headline facts without re-deriving them. `plannedAt` is set from
 * {@link import("./context").PipelineContext.now} when present; the foundation
 * reads no wall clock.
 */
export interface PipelineRunMetadata {
  pipelineId: PipelineId;
  /** Deterministic timestamp for provenance; supplied by the caller. */
  plannedAt?: ISODateTime;
  stageCount: number;
  stepCount: number;
  entityCount: number;
}

/**
 * The result of planning one pipeline run.
 *
 * Generic over the canonical entity type the pipeline would produce. `ok` is
 * `true` only when no blocking {@link PipelineError} was raised; `data` then
 * holds the records the run would carry forward. `state` and `outcome` are
 * derived deterministically from the stats so they can never disagree with the
 * counters.
 */
export interface PipelineResult<T> {
  ok: boolean;
  state: PipelineState;
  outcome: PipelineOutcome;
  data: T[];
  errors: PipelineError[];
  warnings: PipelineWarning[];
  stats: PipelineStats;
  metadata: PipelineRunMetadata;
}
