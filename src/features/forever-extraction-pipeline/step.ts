/**
 * Forever Extraction Pipeline — step models.
 *
 * An {@link ExtractionStep} is the smallest declarative unit of extraction:
 * one classified operation a future runtime would perform when producing
 * facts from a registered source (resolve the catalogued source, pin its
 * revision, describe the method, locate evidence, describe the facts,
 * annotate provenance and confidence, validate, record the attempt) plus
 * optional references to the fact types the step concerns. RC4.5 never *runs*
 * a step — it records the intent so the validation pipeline and a future
 * runtime can reason about the extraction before any reader exists.
 *
 * The references deliberately reuse the module's own closed vocabularies:
 * `factTypes` are {@link ExtractionFactType}s. Every reference is a
 * vocabulary value, never a live handle.
 */

import type { ExtractionFactType } from "./facttype";

/**
 * The closed vocabulary of operations an extraction step may represent.
 *
 * `source` resolves the RC4.4 catalogued source, `version` pins the exact
 * received revision, `method` describes the method a runtime would apply,
 * `locate` describes where evidence would be observed, `extract` describes
 * the facts the source would produce, `annotate` attaches provenance and
 * confidence, `validate` runs the module's validation pipeline, and `record`
 * describes the history entry an attempt would settle into.
 */
export type ExtractionStepKind =
  | "source"
  | "version"
  | "method"
  | "locate"
  | "extract"
  | "annotate"
  | "validate"
  | "record";

/** Every {@link ExtractionStepKind}, in canonical (extraction-flow) order. */
export const EXTRACTION_STEP_KINDS = [
  "source",
  "version",
  "method",
  "locate",
  "extract",
  "annotate",
  "validate",
  "record",
] as const satisfies readonly ExtractionStepKind[];

/** Runtime guard: whether a value is a known {@link ExtractionStepKind}. */
export function isKnownExtractionStepKind(value: unknown): value is ExtractionStepKind {
  return typeof value === "string" && (EXTRACTION_STEP_KINDS as readonly string[]).includes(value);
}

/**
 * One declarative step of extraction.
 *
 * `optional` marks a step whose absence a future runtime may tolerate without
 * failing the whole stage (declarative — RC4.5 never runs it). Every
 * reference field is omitted when unknown, never coerced to a placeholder
 * (anti-fabrication).
 */
export interface ExtractionStep {
  /** Stable id, unique within its stage, e.g. `locate-evidence`. */
  id: string;
  /** Human-readable label. */
  name: string;
  kind: ExtractionStepKind;
  /** The fact types this step concerns, when it narrows to some. */
  factTypes?: ExtractionFactType[];
  /** Whether a future runtime may tolerate this step being absent. */
  optional?: boolean;
  /** Free-text description of the step's responsibility. */
  description?: string;
}

/** Options accepted by {@link extractionStep}. */
export interface ExtractionStepOptions {
  factTypes?: ExtractionFactType[];
  optional?: boolean;
  description?: string;
}

/**
 * Build an {@link ExtractionStep}; optional references are attached only when
 * supplied so an absent fact stays absent (anti-fabrication).
 */
export function extractionStep(
  id: string,
  name: string,
  kind: ExtractionStepKind,
  options: ExtractionStepOptions = {},
): ExtractionStep {
  const step: ExtractionStep = { id, name, kind };
  if (options.factTypes !== undefined) step.factTypes = options.factTypes;
  if (options.optional !== undefined) step.optional = options.optional;
  if (options.description !== undefined) step.description = options.description;
  return step;
}
