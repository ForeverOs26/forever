/**
 * Forever Project Integration — the validation pipeline.
 *
 * Composes the individual guards (identity, version, policy, stage, step,
 * definition, and entry) into one deterministic pass over a
 * {@link ProjectIntegrationRegistry}. This is the single entry point a caller
 * uses before treating a catalogue as coherent. It never throws — it returns a
 * structured verdict.
 *
 * Cross-entry integrity is resolved here: a registry must have an id, and no two
 * entries may share an integration id or a natural `scope:slug` key, so an
 * integration can never be registered twice under a different surrogate id.
 *
 * "Integration validation" names two distinct things that must not be conflated:
 * the integrations this foundation *describes* (stages and steps wiring the other
 * foundations together), and this *validation* pass — a deterministic sequence of
 * guards, never an executing runtime.
 */

import type { ProjectIntegrationRegistry } from "../entry";
import { projectIntegrationDefinitionKey, isNonEmptyString } from "../helpers";
import { partitionProjectIntegrationIssues, projectIntegrationError } from "../result";
import type {
  ProjectIntegrationError,
  ProjectIntegrationIssue,
  ProjectIntegrationWarning,
} from "../types";
import { validateProjectIntegrationRegistryEntry } from "./entry";

/** The structured verdict of {@link validateProjectIntegrationRegistry}. */
export interface ProjectIntegrationValidation {
  valid: boolean;
  issues: ProjectIntegrationIssue[];
  errors: ProjectIntegrationError[];
  warnings: ProjectIntegrationWarning[];
}

/**
 * Run the full validation suite over a registry.
 *
 * Validates the registry id, every entry, and the uniqueness of both surrogate
 * ids and natural `scope:slug` keys across entries. Issues from every check are
 * merged in a stable order.
 */
export function validateProjectIntegrationRegistry(
  registry: ProjectIntegrationRegistry,
): ProjectIntegrationValidation {
  const issues: ProjectIntegrationIssue[] = [];

  if (!isNonEmptyString(registry.id)) {
    issues.push(
      projectIntegrationError(
        "missing_registry_id",
        "Integration registry is missing an id",
        "id",
      ),
    );
  }

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  registry.entries.forEach((entry, index) => {
    issues.push(...validateProjectIntegrationRegistryEntry(entry));

    const id = entry.definition.identity.id;
    if (isNonEmptyString(id)) {
      if (seenIds.has(id)) {
        issues.push(
          projectIntegrationError(
            "duplicate_integration_id",
            `Integration id "${id}" is registered more than once`,
            `entries.${index}.definition.identity.id`,
          ),
        );
      }
      seenIds.add(id);
    }

    const key = projectIntegrationDefinitionKey(entry.definition);
    if (seenKeys.has(key)) {
      issues.push(
        projectIntegrationError(
          "duplicate_integration_key",
          `Integration "${key}" is registered more than once`,
          `entries.${index}.definition.identity.slug`,
        ),
      );
    }
    seenKeys.add(key);
  });

  const { errors, warnings } = partitionProjectIntegrationIssues(issues);
  return { valid: errors.length === 0, issues, errors, warnings };
}
