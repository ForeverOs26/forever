/**
 * Forever Project Factory — stage models.
 *
 * A {@link FactoryStage} is an ordered group of {@link FactoryStep}s that share
 * a coarse phase of project generation: preparing the identity and template,
 * generating the package descriptors, assembling them against the template, or
 * verifying the assembled result. A recipe is an ordered list of stages; a
 * stage is an ordered list of steps. RC4.3 never runs a stage — it describes
 * the grouping so the validation pipeline and a future runtime can reason
 * about it.
 *
 * The four stage kinds are a closed vocabulary so downstream automation stays
 * deterministic and comparable; there are no free-text phase strings. They
 * mirror the RC4.0 integration stage vocabulary in shape while naming the
 * distinct phases of *generation* rather than of *integration*.
 */

import type { FactoryStep } from "./step";

/**
 * The coarse phase a stage belongs to.
 *
 * `prepare` normalizes the verified slug and resolves the identity and
 * template, `generate` describes the package descriptors, `assemble` measures
 * them against the template and describes their registration, and `verify`
 * confirms the generated package is coherent.
 */
export type FactoryStageKind = "prepare" | "generate" | "assemble" | "verify";

/** Every {@link FactoryStageKind}, in a stable declared order. */
export const FACTORY_STAGE_KINDS = [
  "prepare",
  "generate",
  "assemble",
  "verify",
] as const satisfies readonly FactoryStageKind[];

/** Runtime guard: whether a value is a known {@link FactoryStageKind}. */
export function isKnownFactoryStageKind(value: unknown): value is FactoryStageKind {
  return typeof value === "string" && (FACTORY_STAGE_KINDS as readonly string[]).includes(value);
}

/**
 * One stage of project generation: a named, classified, ordered group of steps.
 *
 * `continueOnError` records whether a future runtime may proceed to the next
 * stage after a step in this one fails (declarative — RC4.3 never runs it).
 */
export interface FactoryStage {
  /** Stable id, unique within its recipe, e.g. `prepare`. */
  id: string;
  /** Human-readable label. */
  name: string;
  kind: FactoryStageKind;
  /** The ordered steps of this stage. */
  steps: FactoryStep[];
  /** Whether a future runtime may proceed after a step in this stage fails. */
  continueOnError?: boolean;
}

/** Options accepted by {@link factoryStage}. */
export interface FactoryStageOptions {
  continueOnError?: boolean;
}

/**
 * Build a {@link FactoryStage}; `continueOnError` is attached only when
 * supplied so an absent policy stays absent.
 */
export function factoryStage(
  id: string,
  name: string,
  kind: FactoryStageKind,
  steps: FactoryStep[],
  options: FactoryStageOptions = {},
): FactoryStage {
  const stage: FactoryStage = { id, name, kind, steps };
  if (options.continueOnError !== undefined) stage.continueOnError = options.continueOnError;
  return stage;
}
