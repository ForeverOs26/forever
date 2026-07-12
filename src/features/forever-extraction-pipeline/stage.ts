/**
 * Forever Extraction Pipeline — stage models.
 *
 * An {@link ExtractionStage} is an ordered group of {@link ExtractionStep}s
 * that share a coarse phase of extraction: preparing the source, revision,
 * and method; describing the facts the source would produce; assessing their
 * provenance and confidence; or verifying the described result. A recipe is
 * an ordered list of stages; a stage is an ordered list of steps. RC4.5 never
 * runs a stage — it describes the grouping so the validation pipeline and a
 * future runtime can reason about it.
 *
 * The four stage kinds are a closed vocabulary so downstream automation stays
 * deterministic and comparable; there are no free-text phase strings. They
 * mirror the RC4.3 factory stage vocabulary in shape while naming the
 * distinct phases of *extraction* rather than of *generation*.
 */

import type { ExtractionStep } from "./step";

/**
 * The coarse phase a stage belongs to.
 *
 * `prepare` resolves the catalogued source, pins its revision, and describes
 * the method; `extract` describes the evidence locations and the facts the
 * source would produce; `assess` attaches provenance and confidence; and
 * `verify` confirms the described facts are coherent.
 */
export type ExtractionStageKind = "prepare" | "extract" | "assess" | "verify";

/** Every {@link ExtractionStageKind}, in a stable declared order. */
export const EXTRACTION_STAGE_KINDS = [
  "prepare",
  "extract",
  "assess",
  "verify",
] as const satisfies readonly ExtractionStageKind[];

/** Runtime guard: whether a value is a known {@link ExtractionStageKind}. */
export function isKnownExtractionStageKind(value: unknown): value is ExtractionStageKind {
  return typeof value === "string" && (EXTRACTION_STAGE_KINDS as readonly string[]).includes(value);
}

/**
 * One stage of extraction: a named, classified, ordered group of steps.
 *
 * `continueOnError` records whether a future runtime may proceed to the next
 * stage after a step in this one fails (declarative — RC4.5 never runs it).
 */
export interface ExtractionStage {
  /** Stable id, unique within its recipe, e.g. `prepare`. */
  id: string;
  /** Human-readable label. */
  name: string;
  kind: ExtractionStageKind;
  /** The ordered steps of this stage. */
  steps: ExtractionStep[];
  /** Whether a future runtime may proceed after a step in this stage fails. */
  continueOnError?: boolean;
}

/** Options accepted by {@link extractionStage}. */
export interface ExtractionStageOptions {
  continueOnError?: boolean;
}

/**
 * Build an {@link ExtractionStage}; `continueOnError` is attached only when
 * supplied so an absent policy stays absent.
 */
export function extractionStage(
  id: string,
  name: string,
  kind: ExtractionStageKind,
  steps: ExtractionStep[],
  options: ExtractionStageOptions = {},
): ExtractionStage {
  const stage: ExtractionStage = { id, name, kind, steps };
  if (options.continueOnError !== undefined) stage.continueOnError = options.continueOnError;
  return stage;
}
