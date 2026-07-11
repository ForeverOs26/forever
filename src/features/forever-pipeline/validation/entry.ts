/**
 * Forever Pipeline — entry validation.
 *
 * Guards over a single {@link PipelineRegistryEntry}: its `enabled` flag must be
 * a boolean, and its definition must pass full definition validation. All checks
 * return issues; none throw.
 */

import type { PipelineRegistryEntry } from "../entry";
import { pipelineError } from "../result";
import type { PipelineIssue } from "../types";
import { validatePipelineDefinition } from "./definition";

/** Validate one registry entry's flag and its definition. */
export function validatePipelineRegistryEntry(entry: PipelineRegistryEntry): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  if (typeof entry.enabled !== "boolean") {
    issues.push(
      pipelineError(
        "invalid_enabled_flag",
        `Registry entry has a non-boolean enabled flag "${String(entry.enabled)}"`,
        "enabled",
      ),
    );
  }
  issues.push(...validatePipelineDefinition(entry.definition));
  return issues;
}
