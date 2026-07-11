/**
 * Forever Pipeline — definition validation.
 *
 * Composes the identity, version, policy, and stage guards and adds the checks
 * that span a whole {@link PipelineDefinition}: a pipeline must declare at least
 * one stage, stage ids must be unique, it must handle at least one canonical
 * entity kind without repeating one, and every entity kind a step operates on
 * must be one the pipeline declares it handles (a warning — the step would touch
 * an undeclared entity). All checks return issues; none throw.
 */

import type { PipelineDefinition } from "../definition";
import { isNonEmptyString, listPipelineSteps } from "../helpers";
import { pipelineError, pipelineWarning } from "../result";
import type { PipelineIssue } from "../types";
import { validatePipelineIdentity } from "./identity";
import { validatePipelinePolicy } from "./policy";
import { validatePipelineStage } from "./stage";
import { validatePipelineVersion } from "./version";

/** Validate a whole pipeline definition, composing every sub-guard. */
export function validatePipelineDefinition(definition: PipelineDefinition): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  issues.push(...validatePipelineIdentity(definition.identity));
  issues.push(...validatePipelineVersion(definition.version));
  if (definition.policy !== undefined) {
    issues.push(...validatePipelinePolicy(definition.policy));
  }

  if (definition.stages.length === 0) {
    issues.push(
      pipelineError("no_stages", "Pipeline must declare at least one stage", "stages"),
    );
  }

  const stageIds = new Set<string>();
  definition.stages.forEach((stage, index) => {
    issues.push(...validatePipelineStage(stage, index));
    if (isNonEmptyString(stage.id)) {
      if (stageIds.has(stage.id)) {
        issues.push(
          pipelineError(
            "duplicate_stage_id",
            `Pipeline stage id "${stage.id}" is declared more than once`,
            `stages.${index}.id`,
          ),
        );
      }
      stageIds.add(stage.id);
    }
  });

  if (definition.entities.length === 0) {
    issues.push(
      pipelineError(
        "no_entities",
        "Pipeline must handle at least one canonical entity kind",
        "entities",
      ),
    );
  }
  const seenEntities = new Set<string>();
  definition.entities.forEach((entity, index) => {
    if (seenEntities.has(entity)) {
      issues.push(
        pipelineError(
          "duplicate_entity",
          `Entity kind "${entity}" is declared more than once`,
          `entities.${index}`,
        ),
      );
    }
    seenEntities.add(entity);
  });

  // A step should only touch an entity the pipeline declares it handles.
  listPipelineSteps(definition).forEach((step) => {
    if (step.entityKind !== undefined && !definition.entities.includes(step.entityKind)) {
      issues.push(
        pipelineWarning(
          "undeclared_step_entity",
          `Step "${step.id}" operates on entity "${step.entityKind}" not declared by the pipeline`,
          "entities",
        ),
      );
    }
  });

  return issues;
}
