/**
 * Forever Pipeline — stage validation.
 *
 * Composes the step guard and adds the checks that span a whole
 * {@link PipelineStage}: id and name must be present, `kind` must be a known
 * {@link PipelineStageKind}, the stage must carry at least one step, step ids
 * must be unique within the stage, every `dependsOn` must resolve to a sibling
 * step, and the dependency graph must be acyclic. All checks return issues; none
 * throw.
 */

import { isNonEmptyString, stageStepCycle } from "../helpers";
import { pipelineError } from "../result";
import { isKnownPipelineStageKind, type PipelineStage } from "../stage";
import type { PipelineIssue } from "../types";
import { validatePipelineStep } from "./step";

/** Validate one stage, its steps, and the dependency graph between them. */
export function validatePipelineStage(stage: PipelineStage, stageIndex: number): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  const base = `stages.${stageIndex}`;

  if (!isNonEmptyString(stage.id)) {
    issues.push(pipelineError("missing_stage_id", "Pipeline stage is missing an id", `${base}.id`));
  }
  if (!isNonEmptyString(stage.name)) {
    issues.push(
      pipelineError("missing_stage_name", "Pipeline stage is missing a name", `${base}.name`),
    );
  }
  if (!isKnownPipelineStageKind(stage.kind)) {
    issues.push(
      pipelineError(
        "unknown_stage_kind",
        `Pipeline stage has an unknown kind "${String(stage.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  if (stage.steps.length === 0) {
    issues.push(
      pipelineError(
        "empty_stage",
        `Pipeline stage "${stage.id}" must declare at least one step`,
        `${base}.steps`,
      ),
    );
  }

  const stepIds = new Set<string>();
  stage.steps.forEach((step, stepIndex) => {
    issues.push(...validatePipelineStep(step, stageIndex, stepIndex));
    if (isNonEmptyString(step.id)) {
      if (stepIds.has(step.id)) {
        issues.push(
          pipelineError(
            "duplicate_step_id",
            `Pipeline step id "${step.id}" is declared more than once in its stage`,
            `${base}.steps.${stepIndex}.id`,
          ),
        );
      }
      stepIds.add(step.id);
    }
  });

  // Dependencies must resolve to a sibling step in the same stage.
  stage.steps.forEach((step, stepIndex) => {
    (step.dependsOn ?? []).forEach((depId, depIndex) => {
      if (depId !== step.id && !stepIds.has(depId)) {
        issues.push(
          pipelineError(
            "unresolved_dependency",
            `Pipeline step "${step.id}" depends on unknown step "${depId}"`,
            `${base}.steps.${stepIndex}.dependsOn.${depIndex}`,
          ),
        );
      }
    });
  });

  const cycle = stageStepCycle(stage);
  if (cycle !== undefined) {
    issues.push(
      pipelineError(
        "cyclic_dependencies",
        `Pipeline stage "${stage.id}" has a dependency cycle: ${cycle.join(" -> ")}`,
        `${base}.steps`,
      ),
    );
  }

  return issues;
}
