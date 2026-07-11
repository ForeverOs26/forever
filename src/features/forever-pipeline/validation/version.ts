/**
 * Forever Pipeline — version validation.
 *
 * Guards that a {@link PipelineVersion} carries non-negative integer components.
 * The optional `label` is free text and never validated for shape. All checks
 * return issues; none throw.
 */

import { pipelineError } from "../result";
import type { PipelineIssue } from "../types";
import type { PipelineVersion } from "../version";

function validatePart(value: number, name: string, issues: PipelineIssue[]): void {
  if (!Number.isInteger(value) || value < 0) {
    issues.push(
      pipelineError(
        "invalid_version_part",
        `Pipeline version ${name} must be a non-negative integer`,
        `version.${name}`,
      ),
    );
  }
}

/** Validate that a version's numeric components are non-negative integers. */
export function validatePipelineVersion(version: PipelineVersion): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  validatePart(version.major, "major", issues);
  validatePart(version.minor, "minor", issues);
  validatePart(version.patch, "patch", issues);
  return issues;
}
