/**
 * Forever Extraction Pipeline — stage validation.
 *
 * Composes the step guard and adds the checks that span a whole
 * {@link ExtractionStage}: id and name must be present, `kind` must be a
 * known {@link import("../stage").ExtractionStageKind}, the stage must carry
 * at least one step, and step ids must be unique within the stage. All checks
 * return issues; none throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import { isKnownExtractionStageKind, type ExtractionStage } from "../stage";
import { extractionError } from "../types";
import type { ExtractionIssue } from "../types";
import { validateExtractionStep } from "./step";

/** Validate one stage and its steps. `base` locates it, e.g. `stages.0`. */
export function validateExtractionStage(stage: ExtractionStage, base: string): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];

  if (!isNonEmptyString(stage.id)) {
    issues.push(
      extractionError("missing_stage_id", "Extraction stage is missing an id", `${base}.id`),
    );
  }
  if (!isNonEmptyString(stage.name)) {
    issues.push(
      extractionError("missing_stage_name", "Extraction stage is missing a name", `${base}.name`),
    );
  }
  if (!isKnownExtractionStageKind(stage.kind)) {
    issues.push(
      extractionError(
        "unknown_stage_kind",
        `Extraction stage has an unknown kind "${String(stage.kind)}"`,
        `${base}.kind`,
      ),
    );
  }

  const steps = Array.isArray(stage.steps) ? stage.steps : [];
  if (steps.length === 0) {
    issues.push(
      extractionError(
        "empty_stage",
        `Extraction stage "${String(stage.id)}" must declare at least one step`,
        `${base}.steps`,
      ),
    );
  }

  const stepIds = new Set<string>();
  steps.forEach((step, index) => {
    if (isAbsent(step)) {
      issues.push(
        extractionError(
          "missing_step",
          "Extraction stage declares an absent step",
          `${base}.steps.${index}`,
        ),
      );
      return;
    }
    issues.push(...validateExtractionStep(step, `${base}.steps.${index}`));
    if (isNonEmptyString(step.id)) {
      if (stepIds.has(step.id)) {
        issues.push(
          extractionError(
            "duplicate_step_id",
            `Extraction step id "${step.id}" is declared more than once in its stage`,
            `${base}.steps.${index}.id`,
          ),
        );
      }
      stepIds.add(step.id);
    }
  });

  return issues;
}
