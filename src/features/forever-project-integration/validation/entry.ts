/**
 * Forever Project Integration — entry validation.
 *
 * Guards over a single {@link ProjectIntegrationRegistryEntry}: its `enabled`
 * flag must be a boolean, and its definition must pass full definition
 * validation. All checks return issues; none throw.
 */

import type { ProjectIntegrationRegistryEntry } from "../entry";
import { projectIntegrationError } from "../result";
import type { ProjectIntegrationIssue } from "../types";
import { validateProjectIntegrationDefinition } from "./definition";

/** Validate one registry entry's flag and its definition. */
export function validateProjectIntegrationRegistryEntry(
  entry: ProjectIntegrationRegistryEntry,
): ProjectIntegrationIssue[] {
  const issues: ProjectIntegrationIssue[] = [];
  if (typeof entry.enabled !== "boolean") {
    issues.push(
      projectIntegrationError(
        "invalid_enabled_flag",
        `Registry entry has a non-boolean enabled flag "${String(entry.enabled)}"`,
        "enabled",
      ),
    );
  }
  issues.push(...validateProjectIntegrationDefinition(entry.definition));
  return issues;
}
