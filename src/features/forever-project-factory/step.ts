/**
 * Forever Project Factory — step models.
 *
 * A {@link FactoryStep} is the smallest declarative unit of project generation:
 * one classified operation a factory performs when producing a package from the
 * RC4.2 template (normalize and derive identity, select the template, describe
 * the package, render its layout, assemble the bundle, validate it, describe
 * its registration) plus optional references to what the step materializes.
 * RC4.3 never *runs* a step — it records the intent so the validation pipeline
 * and a future runtime can reason about the generation before any writer,
 * scaffolder, or persistence exists.
 *
 * The references deliberately reuse the neighbouring foundations rather than
 * restating them: `components` are the RC4.2 {@link ProjectComponentKind}s the
 * step materializes (which themselves name the RC3.0/3.3/3.4/3.5/4.0/4.1
 * foundations), and `entityKind` is a Forever Import (RC3.1) kind. Every
 * reference is a vocabulary value, never a live handle.
 */

import type { ProjectComponentKind } from "@/features/forever-project-template";

import type { FactoryEntityKind } from "./types";

/**
 * The closed vocabulary of operations a factory step may represent.
 *
 * `identity` derives the canonical ids/slugs (RC3.0 via RC4.2), `template`
 * resolves the RC4.2 template to generate from, `package` describes the
 * generated package descriptor, `layout` renders the package layout for the
 * project slug, `bundle` measures the package against the template, `validate`
 * runs the reused RC4.2 validation pipeline, and `register` describes the
 * catalogue entry a registrar would add.
 */
export type FactoryStepKind =
  | "identity"
  | "template"
  | "package"
  | "layout"
  | "bundle"
  | "validate"
  | "register";

/** Every {@link FactoryStepKind}, in canonical (generation-flow) order. */
export const FACTORY_STEP_KINDS = [
  "identity",
  "template",
  "package",
  "layout",
  "bundle",
  "validate",
  "register",
] as const satisfies readonly FactoryStepKind[];

/** Runtime guard: whether a value is a known {@link FactoryStepKind}. */
export function isKnownFactoryStepKind(value: unknown): value is FactoryStepKind {
  return typeof value === "string" && (FACTORY_STEP_KINDS as readonly string[]).includes(value);
}

/**
 * One declarative step of project generation.
 *
 * `optional` marks a step whose absence a future runtime may tolerate without
 * failing the whole stage (declarative — RC4.3 never runs it). Every reference
 * field is omitted when unknown, never coerced to a placeholder
 * (anti-fabrication).
 */
export interface FactoryStep {
  /** Stable id, unique within its stage, e.g. `derive-identity`. */
  id: string;
  /** Human-readable label. */
  name: string;
  kind: FactoryStepKind;
  /** The RC4.2 component kinds this step materializes, when any. */
  components?: ProjectComponentKind[];
  /** Canonical entity this step concerns. Reuses the RC3.1 kinds. */
  entityKind?: FactoryEntityKind;
  /** Whether a future runtime may tolerate this step being absent. */
  optional?: boolean;
  /** Free-text description of the step's responsibility. */
  description?: string;
}

/** Options accepted by {@link factoryStep}. */
export interface FactoryStepOptions {
  components?: ProjectComponentKind[];
  entityKind?: FactoryEntityKind;
  optional?: boolean;
  description?: string;
}

/**
 * Build a {@link FactoryStep}; optional references are attached only when
 * supplied so an absent fact stays absent (anti-fabrication).
 */
export function factoryStep(
  id: string,
  name: string,
  kind: FactoryStepKind,
  options: FactoryStepOptions = {},
): FactoryStep {
  const step: FactoryStep = { id, name, kind };
  if (options.components !== undefined) step.components = options.components;
  if (options.entityKind !== undefined) step.entityKind = options.entityKind;
  if (options.optional !== undefined) step.optional = options.optional;
  if (options.description !== undefined) step.description = options.description;
  return step;
}
