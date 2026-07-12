/**
 * Forever Project Integration — definition validation.
 *
 * Composes the identity, version, policy, and stage guards and adds the checks
 * that span a whole {@link ProjectIntegrationDefinition}: an integration must
 * declare at least one stage, stage ids must be unique, it must handle at least
 * one canonical entity kind without repeating one, every entity kind a step
 * operates on must be one the integration declares it handles (a warning — the
 * step would touch an undeclared entity), and a classified step should carry the
 * reference its kind implies (a warning — e.g. a `pipeline` step with no
 * `pipelineId`). All checks return issues; none throw.
 */

import type { ProjectIntegrationDefinition } from "../definition";
import { isNonEmptyString, listProjectIntegrationSteps } from "../helpers";
import { projectIntegrationError, projectIntegrationWarning } from "../result";
import type { ProjectIntegrationIssue } from "../types";
import { validateProjectIntegrationIdentity } from "./identity";
import { validateProjectIntegrationPolicy } from "./policy";
import { validateProjectIntegrationStage } from "./stage";
import { validateProjectIntegrationVersion } from "./version";

/** Validate a whole integration definition, composing every sub-guard. */
export function validateProjectIntegrationDefinition(
  definition: ProjectIntegrationDefinition,
): ProjectIntegrationIssue[] {
  const issues: ProjectIntegrationIssue[] = [];
  issues.push(...validateProjectIntegrationIdentity(definition.identity));
  issues.push(...validateProjectIntegrationVersion(definition.version));
  if (definition.policy !== undefined) {
    issues.push(...validateProjectIntegrationPolicy(definition.policy));
  }

  if (definition.stages.length === 0) {
    issues.push(
      projectIntegrationError(
        "no_stages",
        "Integration must declare at least one stage",
        "stages",
      ),
    );
  }

  const stageIds = new Set<string>();
  definition.stages.forEach((stage, index) => {
    issues.push(...validateProjectIntegrationStage(stage, index));
    if (isNonEmptyString(stage.id)) {
      if (stageIds.has(stage.id)) {
        issues.push(
          projectIntegrationError(
            "duplicate_stage_id",
            `Integration stage id "${stage.id}" is declared more than once`,
            `stages.${index}.id`,
          ),
        );
      }
      stageIds.add(stage.id);
    }
  });

  if (definition.entities.length === 0) {
    issues.push(
      projectIntegrationError(
        "no_entities",
        "Integration must handle at least one canonical entity kind",
        "entities",
      ),
    );
  }
  const seenEntities = new Set<string>();
  definition.entities.forEach((entity, index) => {
    if (seenEntities.has(entity)) {
      issues.push(
        projectIntegrationError(
          "duplicate_entity",
          `Entity kind "${entity}" is declared more than once`,
          `entities.${index}`,
        ),
      );
    }
    seenEntities.add(entity);
  });

  // A step should only touch an entity the integration declares it handles, and
  // a classified step should carry the reference its kind implies.
  listProjectIntegrationSteps(definition).forEach((step) => {
    if (step.entityKind !== undefined && !definition.entities.includes(step.entityKind)) {
      issues.push(
        projectIntegrationWarning(
          "undeclared_step_entity",
          `Step "${step.id}" operates on entity "${step.entityKind}" not declared by the integration`,
          "entities",
        ),
      );
    }
    if (step.kind === "source" && step.sourceId === undefined) {
      issues.push(
        projectIntegrationWarning(
          "source_step_without_source",
          `Source step "${step.id}" does not reference a registered source`,
          "stages",
        ),
      );
    }
    if (step.kind === "connector" && step.connectorId === undefined) {
      issues.push(
        projectIntegrationWarning(
          "connector_step_without_connector",
          `Connector step "${step.id}" does not reference a connector`,
          "stages",
        ),
      );
    }
    if (step.kind === "pipeline" && step.pipelineId === undefined) {
      issues.push(
        projectIntegrationWarning(
          "pipeline_step_without_pipeline",
          `Pipeline step "${step.id}" does not reference a pipeline`,
          "stages",
        ),
      );
    }
    if (step.kind === "sync" && step.system === undefined) {
      issues.push(
        projectIntegrationWarning(
          "sync_step_without_system",
          `Sync step "${step.id}" does not reference a system`,
          "stages",
        ),
      );
    }
  });

  return issues;
}
