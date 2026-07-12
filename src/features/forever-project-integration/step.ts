/**
 * Forever Project Integration — step models.
 *
 * A {@link ProjectIntegrationStep} is the smallest declarative unit of an
 * integration: one classified operation (bind a registered source, bind a
 * connector, run a pipeline, reconcile through a sync system, verify readiness)
 * plus optional references to the foundations it would use. RC4.0 never *runs* a
 * step — it records the intent so a future runtime and the validation pipeline
 * can reason about the integration before any transport, adapter, pipeline
 * runtime, or writer exists.
 *
 * The references deliberately reuse the neighbouring foundations rather than
 * restating them: `entityKind` is a Forever Import (RC3.1) kind, `sourceId`
 * points at a Forever Source Registry (RC3.3) source, `connectorId` points at a
 * Forever Connectors (RC3.4) connector, `pipelineId` points at a Forever Pipeline
 * (RC3.5) pipeline, and `system`/`direction` reuse the Forever Sync (RC3.2)
 * vocabularies — so a described step lines up with the source it reads, the
 * connector it moves through, the pipeline it drives, and the system it
 * reconciles with. Every reference is an id or a vocabulary value, never a live
 * handle.
 *
 * `dependsOn` names the sibling steps (within the same stage) a step follows,
 * declaring an explicit dependency graph. It is a descriptor: RC4.0 orders and
 * cycle-checks it purely (see
 * {@link import("./helpers").orderIntegrationStageSteps}) but never schedules or
 * executes it.
 */

import type { SyncDirection, SyncSystem } from "@/features/forever-sync";
import type { SourceId } from "@/features/forever-source-registry";
import type { ConnectorId } from "@/features/forever-connectors";
import type { PipelineId } from "@/features/forever-pipeline";

import type { ProjectIntegrationEntityKind } from "./types";

/** The closed vocabulary of operations an integration step may represent. */
export type ProjectIntegrationStepKind =
  | "source"
  | "connector"
  | "pipeline"
  | "sync"
  | "verify";

/** Every {@link ProjectIntegrationStepKind}, in a stable declared order. */
export const PROJECT_INTEGRATION_STEP_KINDS = [
  "source",
  "connector",
  "pipeline",
  "sync",
  "verify",
] as const satisfies readonly ProjectIntegrationStepKind[];

/** Runtime guard: whether a value is a known {@link ProjectIntegrationStepKind}. */
export function isKnownProjectIntegrationStepKind(
  value: unknown,
): value is ProjectIntegrationStepKind {
  return (
    typeof value === "string" &&
    (PROJECT_INTEGRATION_STEP_KINDS as readonly string[]).includes(value)
  );
}

/**
 * One declarative step of an integration.
 *
 * `optional` marks a step whose failure a future runtime may tolerate without
 * failing the whole stage (declarative — RC4.0 never runs it). Every reference
 * field is omitted when unknown, never coerced to a placeholder
 * (anti-fabrication).
 */
export interface ProjectIntegrationStep {
  /** Stable id, unique within its stage, e.g. `bind_website`. */
  id: string;
  /** Human-readable label. */
  name: string;
  kind: ProjectIntegrationStepKind;
  /** Canonical entity this step operates on. Reuses the RC3.1 kinds. */
  entityKind?: ProjectIntegrationEntityKind;
  /** The registered source this step reads. Reuses the RC3.3 source id. */
  sourceId?: SourceId;
  /** The connector this step moves through. Reuses the RC3.4 connector id. */
  connectorId?: ConnectorId;
  /** The pipeline this step drives. Reuses the RC3.5 pipeline id. */
  pipelineId?: PipelineId;
  /** The system a sync-type step reconciles with. Reuses the RC3.2 vocabulary. */
  system?: SyncSystem;
  /** The direction of flow for a sync-type step. Reuses the RC3.2 vocabulary. */
  direction?: SyncDirection;
  /** Ids of sibling steps (same stage) this step depends on. Never scheduled. */
  dependsOn?: string[];
  /** Whether a future runtime may tolerate this step failing. */
  optional?: boolean;
}

/** Options accepted by {@link projectIntegrationStep}. */
export interface ProjectIntegrationStepOptions {
  entityKind?: ProjectIntegrationEntityKind;
  sourceId?: SourceId;
  connectorId?: ConnectorId;
  pipelineId?: PipelineId;
  system?: SyncSystem;
  direction?: SyncDirection;
  dependsOn?: string[];
  optional?: boolean;
}

/**
 * Build a {@link ProjectIntegrationStep}; optional references are attached only
 * when supplied so an absent fact stays absent (anti-fabrication).
 */
export function projectIntegrationStep(
  id: string,
  name: string,
  kind: ProjectIntegrationStepKind,
  options: ProjectIntegrationStepOptions = {},
): ProjectIntegrationStep {
  const step: ProjectIntegrationStep = { id, name, kind };
  if (options.entityKind !== undefined) step.entityKind = options.entityKind;
  if (options.sourceId !== undefined) step.sourceId = options.sourceId;
  if (options.connectorId !== undefined) step.connectorId = options.connectorId;
  if (options.pipelineId !== undefined) step.pipelineId = options.pipelineId;
  if (options.system !== undefined) step.system = options.system;
  if (options.direction !== undefined) step.direction = options.direction;
  if (options.dependsOn !== undefined) step.dependsOn = options.dependsOn;
  if (options.optional !== undefined) step.optional = options.optional;
  return step;
}
