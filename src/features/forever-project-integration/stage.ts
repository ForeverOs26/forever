/**
 * Forever Project Integration — stage models.
 *
 * A {@link ProjectIntegrationStage} is an ordered group of
 * {@link ProjectIntegrationStep}s that share a coarse phase of the integration:
 * acquiring project data from its sources, processing it through pipelines,
 * reconciling it with the systems Forever synchronizes with, or verifying the
 * project is ready. An integration is an ordered list of stages; a stage is an
 * ordered list of steps. RC4.0 never runs a stage — it describes the grouping so
 * a future runtime and the validation pipeline can reason about it.
 *
 * The four stage kinds are a closed vocabulary so downstream automation stays
 * deterministic and comparable; there are no free-text phase strings.
 */

import type { ProjectIntegrationStep } from "./step";

/**
 * The coarse phase a stage belongs to.
 *
 * `acquire` binds the project's sources and connectors, `process` drives the
 * pipelines that import and shape its data, `reconcile` synchronizes it with the
 * Forever systems, and `verify` confirms the project's readiness.
 */
export type ProjectIntegrationStageKind = "acquire" | "process" | "reconcile" | "verify";

/** Every {@link ProjectIntegrationStageKind}, in a stable declared order. */
export const PROJECT_INTEGRATION_STAGE_KINDS = [
  "acquire",
  "process",
  "reconcile",
  "verify",
] as const satisfies readonly ProjectIntegrationStageKind[];

/** Runtime guard: whether a value is a known {@link ProjectIntegrationStageKind}. */
export function isKnownProjectIntegrationStageKind(
  value: unknown,
): value is ProjectIntegrationStageKind {
  return (
    typeof value === "string" &&
    (PROJECT_INTEGRATION_STAGE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * One stage of an integration: a named, classified, ordered group of steps.
 *
 * `continueOnError` records whether a future runtime may proceed to the next
 * stage after a step in this one fails (declarative — RC4.0 never runs it).
 */
export interface ProjectIntegrationStage {
  /** Stable id, unique within its integration, e.g. `acquire_coralina`. */
  id: string;
  /** Human-readable label. */
  name: string;
  kind: ProjectIntegrationStageKind;
  /** The ordered steps of this stage. */
  steps: ProjectIntegrationStep[];
  /** Whether a future runtime may proceed after a step in this stage fails. */
  continueOnError?: boolean;
}

/** Options accepted by {@link projectIntegrationStage}. */
export interface ProjectIntegrationStageOptions {
  continueOnError?: boolean;
}

/**
 * Build a {@link ProjectIntegrationStage}; `continueOnError` is attached only
 * when supplied so an absent policy stays absent.
 */
export function projectIntegrationStage(
  id: string,
  name: string,
  kind: ProjectIntegrationStageKind,
  steps: ProjectIntegrationStep[],
  options: ProjectIntegrationStageOptions = {},
): ProjectIntegrationStage {
  const stage: ProjectIntegrationStage = { id, name, kind, steps };
  if (options.continueOnError !== undefined) stage.continueOnError = options.continueOnError;
  return stage;
}
