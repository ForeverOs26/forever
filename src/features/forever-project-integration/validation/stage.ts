/**
 * Forever Project Integration — stage validation.
 *
 * Composes the step guard and adds the checks that span a whole
 * {@link ProjectIntegrationStage}: id and name must be present, `kind` must be a
 * known {@link ProjectIntegrationStageKind}, the stage must carry at least one
 * step, step ids must be unique within the stage, every `dependsOn` must resolve
 * to a sibling step, and the dependency graph must be acyclic. All checks return
 * issues; none throw.
 */

import { integrationStageStepCycle, isNonEmptyString } from "../helpers";
import { projectIntegrationError } from "../result";
import {
  isKnownProjectIntegrationStageKind,
  type ProjectIntegrationStage,
} from "../stage";
import type { ProjectIntegrationIssue } from "../types";
import { validateProjectIntegrationStep } from "./step";

/** Validate one stage, its steps, and the dependency graph between them. */
export function validateProjectIntegrationStage(
  stage: ProjectIntegrationStage,
  stageIndex: number,
): ProjectIntegrationIssue[] {
  const issues: ProjectIntegrationIssue[] = [];
  const base = `stages.${stageIndex}`;

  if (!isNonEmptyString(stage.id)) {
    issues.push(
      projectIntegrationError("missing_stage_id", "Integration stage is missing an id", `${base}.id`),
    );
  }
  if (!isNonEmptyString(stage.name)) {
    issues.push(
      projectIntegrationError(
        "missing_stage_name",
        "Integration stage is missing a name",
        `${base}.name`,
      ),
    );
  }
  if (!isKnownProjectIntegrationStageKind(stage.kind)) {
    issues.push(
      projectIntegrationError(
        "unknown_stage_kind",
        `Integration stage has an unknown kind "${String(stage.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  if (stage.steps.length === 0) {
    issues.push(
      projectIntegrationError(
        "empty_stage",
        `Integration stage "${stage.id}" must declare at least one step`,
        `${base}.steps`,
      ),
    );
  }

  const stepIds = new Set<string>();
  stage.steps.forEach((step, stepIndex) => {
    issues.push(...validateProjectIntegrationStep(step, stageIndex, stepIndex));
    if (isNonEmptyString(step.id)) {
      if (stepIds.has(step.id)) {
        issues.push(
          projectIntegrationError(
            "duplicate_step_id",
            `Integration step id "${step.id}" is declared more than once in its stage`,
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
          projectIntegrationError(
            "unresolved_dependency",
            `Integration step "${step.id}" depends on unknown step "${depId}"`,
            `${base}.steps.${stepIndex}.dependsOn.${depIndex}`,
          ),
        );
      }
    });
  });

  const cycle = integrationStageStepCycle(stage);
  if (cycle !== undefined) {
    issues.push(
      projectIntegrationError(
        "cyclic_dependencies",
        `Integration stage "${stage.id}" has a dependency cycle: ${cycle.join(" -> ")}`,
        `${base}.steps`,
      ),
    );
  }

  return issues;
}
