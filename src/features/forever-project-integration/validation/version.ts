/**
 * Forever Project Integration — version validation.
 *
 * Guards that a {@link ProjectIntegrationVersion} carries non-negative integer
 * components. The optional `label` is free text and never validated for shape.
 * All checks return issues; none throw.
 */

import { projectIntegrationError } from "../result";
import type { ProjectIntegrationIssue } from "../types";
import type { ProjectIntegrationVersion } from "../version";

function validatePart(
  value: number,
  name: string,
  issues: ProjectIntegrationIssue[],
): void {
  if (!Number.isInteger(value) || value < 0) {
    issues.push(
      projectIntegrationError(
        "invalid_version_part",
        `Integration version ${name} must be a non-negative integer`,
        `version.${name}`,
      ),
    );
  }
}

/** Validate that a version's numeric components are non-negative integers. */
export function validateProjectIntegrationVersion(
  version: ProjectIntegrationVersion,
): ProjectIntegrationIssue[] {
  const issues: ProjectIntegrationIssue[] = [];
  validatePart(version.major, "major", issues);
  validatePart(version.minor, "minor", issues);
  validatePart(version.patch, "patch", issues);
  return issues;
}
