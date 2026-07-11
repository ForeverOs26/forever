/**
 * Forever Pipeline — step models.
 *
 * A {@link PipelineStep} is the smallest declarative unit of a pipeline: one
 * classified operation (acquire from a source, run an import adapter, normalize,
 * validate, synchronize, publish, …) plus optional references to the
 * foundations it would use. RC3.5 never *runs* a step — it records the intent so
 * a future runtime and the validation pipeline can reason about the pipeline
 * before any transport, adapter, or writer exists.
 *
 * The references deliberately reuse the neighbouring foundations rather than
 * restating them: `entityKind` is a Forever Import (RC3.1) kind, `direction` is
 * a Forever Sync (RC3.2) direction, `sourceId` points at a Forever Source
 * Registry (RC3.3) source, and `connectorId` points at a Forever Connectors
 * (RC3.4) connector — so a described step lines up with the source it reads and
 * the connector it moves through. Every reference is an id, never a live handle.
 *
 * `dependsOn` names the sibling steps (within the same stage) a step follows,
 * declaring an explicit dependency graph. It is a descriptor: RC3.5 orders and
 * cycle-checks it purely (see {@link import("./helpers").orderStageSteps}) but
 * never schedules or executes it.
 */

import type { SyncDirection } from "@/features/forever-sync";
import type { SourceId } from "@/features/forever-source-registry";
import type { ConnectorId } from "@/features/forever-connectors";

import type { PipelineEntityKind } from "./types";

/** The closed vocabulary of operations a pipeline step may represent. */
export type PipelineStepKind =
  | "source"
  | "connect"
  | "extract"
  | "import"
  | "normalize"
  | "validate"
  | "transform"
  | "sync"
  | "persist"
  | "publish";

/** Every {@link PipelineStepKind}, in a stable declared order. */
export const PIPELINE_STEP_KINDS = [
  "source",
  "connect",
  "extract",
  "import",
  "normalize",
  "validate",
  "transform",
  "sync",
  "persist",
  "publish",
] as const satisfies readonly PipelineStepKind[];

/** Runtime guard: whether a value is a known {@link PipelineStepKind}. */
export function isKnownPipelineStepKind(value: unknown): value is PipelineStepKind {
  return typeof value === "string" && (PIPELINE_STEP_KINDS as readonly string[]).includes(value);
}

/**
 * One declarative step of a pipeline.
 *
 * `optional` marks a step whose failure a future runtime may tolerate without
 * failing the whole stage (declarative — RC3.5 never runs it). Every reference
 * field is omitted when unknown, never coerced to a placeholder
 * (anti-fabrication).
 */
export interface PipelineStep {
  /** Stable id, unique within its stage, e.g. `extract_price_list`. */
  id: string;
  /** Human-readable label. */
  name: string;
  kind: PipelineStepKind;
  /** Canonical entity this step operates on. Reuses the RC3.1 kinds. */
  entityKind?: PipelineEntityKind;
  /** The registered source this step reads. Reuses the RC3.3 source id. */
  sourceId?: SourceId;
  /** The connector this step moves through. Reuses the RC3.4 connector id. */
  connectorId?: ConnectorId;
  /** The direction of flow for a sync-type step. Reuses the RC3.2 vocabulary. */
  direction?: SyncDirection;
  /** Ids of sibling steps (same stage) this step depends on. Never scheduled. */
  dependsOn?: string[];
  /** Whether a future runtime may tolerate this step failing. */
  optional?: boolean;
}

/** Options accepted by {@link pipelineStep}. */
export interface PipelineStepOptions {
  entityKind?: PipelineEntityKind;
  sourceId?: SourceId;
  connectorId?: ConnectorId;
  direction?: SyncDirection;
  dependsOn?: string[];
  optional?: boolean;
}

/**
 * Build a {@link PipelineStep}; optional references are attached only when
 * supplied so an absent fact stays absent (anti-fabrication).
 */
export function pipelineStep(
  id: string,
  name: string,
  kind: PipelineStepKind,
  options: PipelineStepOptions = {},
): PipelineStep {
  const step: PipelineStep = { id, name, kind };
  if (options.entityKind !== undefined) step.entityKind = options.entityKind;
  if (options.sourceId !== undefined) step.sourceId = options.sourceId;
  if (options.connectorId !== undefined) step.connectorId = options.connectorId;
  if (options.direction !== undefined) step.direction = options.direction;
  if (options.dependsOn !== undefined) step.dependsOn = options.dependsOn;
  if (options.optional !== undefined) step.optional = options.optional;
  return step;
}
