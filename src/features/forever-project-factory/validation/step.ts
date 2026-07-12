/**
 * Forever Project Factory — step validation.
 *
 * Structural guards over a {@link FactoryStep}: id and name must be present,
 * `kind` must be a known {@link import("../step").FactoryStepKind}, every
 * materialized component must be a known RC4.2 component kind (reusing the
 * RC4.2 runtime guard, never a local list) declared at most once, and
 * `entityKind` (when present) must be a known RC3.1 entity kind. All checks
 * return issues; none throw.
 */

import { isKnownProjectComponentKind } from "@/features/forever-project-template";

import { isNonEmptyString } from "../helpers";
import { isKnownFactoryStepKind, type FactoryStep } from "../step";
import { factoryError, isKnownFactoryEntityKind } from "../types";
import type { FactoryIssue } from "../types";

/** Validate one step of a recipe. `base` locates it, e.g. `stages.0.steps.1`. */
export function validateFactoryStep(step: FactoryStep, base: string): FactoryIssue[] {
  const issues: FactoryIssue[] = [];

  if (!isNonEmptyString(step.id)) {
    issues.push(factoryError("missing_step_id", "Factory step is missing an id", `${base}.id`));
  }
  if (!isNonEmptyString(step.name)) {
    issues.push(
      factoryError("missing_step_name", "Factory step is missing a name", `${base}.name`),
    );
  }
  if (!isKnownFactoryStepKind(step.kind)) {
    issues.push(
      factoryError(
        "unknown_step_kind",
        `Factory step has an unknown kind "${String(step.kind)}"`,
        `${base}.kind`,
      ),
    );
  }

  const seenComponents = new Set<string>();
  (Array.isArray(step.components) ? step.components : []).forEach((kind, index) => {
    if (!isKnownProjectComponentKind(kind)) {
      issues.push(
        factoryError(
          "unknown_step_component",
          `Factory step materializes an unknown component "${String(kind)}"`,
          `${base}.components.${index}`,
        ),
      );
    }
    if (seenComponents.has(kind)) {
      issues.push(
        factoryError(
          "duplicate_step_component",
          `Factory step materializes component "${String(kind)}" more than once`,
          `${base}.components.${index}`,
        ),
      );
    }
    seenComponents.add(kind);
  });

  if (step.entityKind !== undefined && !isKnownFactoryEntityKind(step.entityKind)) {
    issues.push(
      factoryError(
        "unknown_step_entity",
        `Factory step concerns an unknown entity kind "${String(step.entityKind)}"`,
        `${base}.entityKind`,
      ),
    );
  }

  return issues;
}
