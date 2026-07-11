/**
 * Forever Pipeline — stage models.
 *
 * A {@link PipelineStage} is an ordered group of {@link PipelineStep}s that share
 * a coarse phase of the pipeline: ingesting raw data, transforming it to
 * canonical shape, validating it, or distributing it onward. A pipeline is an
 * ordered list of stages; a stage is an ordered list of steps. RC3.5 never runs
 * a stage — it describes the grouping so a future runtime and the validation
 * pipeline can reason about it.
 *
 * The four stage kinds are a closed vocabulary so downstream automation stays
 * deterministic and comparable; there are no free-text phase strings.
 */

import type { PipelineStep } from "./step";

/**
 * The coarse phase a stage belongs to.
 *
 * `ingest` acquires and imports raw data, `transform` maps it to the canonical
 * shape, `validate` checks its integrity, and `distribute` synchronizes or
 * publishes it onward.
 */
export type PipelineStageKind = "ingest" | "transform" | "validate" | "distribute";

/** Every {@link PipelineStageKind}, in a stable declared order. */
export const PIPELINE_STAGE_KINDS = [
  "ingest",
  "transform",
  "validate",
  "distribute",
] as const satisfies readonly PipelineStageKind[];

/** Runtime guard: whether a value is a known {@link PipelineStageKind}. */
export function isKnownPipelineStageKind(value: unknown): value is PipelineStageKind {
  return typeof value === "string" && (PIPELINE_STAGE_KINDS as readonly string[]).includes(value);
}

/**
 * One stage of a pipeline: a named, classified, ordered group of steps.
 *
 * `continueOnError` records whether a future runtime may proceed to the next
 * stage after a step in this one fails (declarative — RC3.5 never runs it).
 */
export interface PipelineStage {
  /** Stable id, unique within its pipeline, e.g. `ingest_coralina`. */
  id: string;
  /** Human-readable label. */
  name: string;
  kind: PipelineStageKind;
  /** The ordered steps of this stage. */
  steps: PipelineStep[];
  /** Whether a future runtime may proceed after a step in this stage fails. */
  continueOnError?: boolean;
}

/** Options accepted by {@link pipelineStage}. */
export interface PipelineStageOptions {
  continueOnError?: boolean;
}

/**
 * Build a {@link PipelineStage}; `continueOnError` is attached only when
 * supplied so an absent policy stays absent.
 */
export function pipelineStage(
  id: string,
  name: string,
  kind: PipelineStageKind,
  steps: PipelineStep[],
  options: PipelineStageOptions = {},
): PipelineStage {
  const stage: PipelineStage = { id, name, kind, steps };
  if (options.continueOnError !== undefined) stage.continueOnError = options.continueOnError;
  return stage;
}
