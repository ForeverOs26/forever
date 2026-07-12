/**
 * Forever Project Factory — stage validation.
 *
 * Composes the step guard and adds the checks that span a whole
 * {@link FactoryStage}: id and name must be present, `kind` must be a known
 * {@link import("../stage").FactoryStageKind}, the stage must carry at least
 * one step, and step ids must be unique within the stage. All checks return
 * issues; none throw.
 */

import { isNonEmptyString } from "../helpers";
import { isKnownFactoryStageKind, type FactoryStage } from "../stage";
import { factoryError } from "../types";
import type { FactoryIssue } from "../types";
import { validateFactoryStep } from "./step";

/** Validate one stage and its steps. `base` locates it, e.g. `stages.0`. */
export function validateFactoryStage(stage: FactoryStage, base: string): FactoryIssue[] {
  const issues: FactoryIssue[] = [];

  if (!isNonEmptyString(stage.id)) {
    issues.push(factoryError("missing_stage_id", "Factory stage is missing an id", `${base}.id`));
  }
  if (!isNonEmptyString(stage.name)) {
    issues.push(
      factoryError("missing_stage_name", "Factory stage is missing a name", `${base}.name`),
    );
  }
  if (!isKnownFactoryStageKind(stage.kind)) {
    issues.push(
      factoryError(
        "unknown_stage_kind",
        `Factory stage has an unknown kind "${String(stage.kind)}"`,
        `${base}.kind`,
      ),
    );
  }

  const steps = Array.isArray(stage.steps) ? stage.steps : [];
  if (steps.length === 0) {
    issues.push(
      factoryError(
        "empty_stage",
        `Factory stage "${String(stage.id)}" must declare at least one step`,
        `${base}.steps`,
      ),
    );
  }

  const stepIds = new Set<string>();
  steps.forEach((step, index) => {
    issues.push(...validateFactoryStep(step, `${base}.steps.${index}`));
    if (isNonEmptyString(step.id)) {
      if (stepIds.has(step.id)) {
        issues.push(
          factoryError(
            "duplicate_step_id",
            `Factory step id "${step.id}" is declared more than once in its stage`,
            `${base}.steps.${index}.id`,
          ),
        );
      }
      stepIds.add(step.id);
    }
  });

  return issues;
}
