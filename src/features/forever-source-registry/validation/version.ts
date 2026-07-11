/**
 * Forever Source Registry — version validation.
 *
 * Guards that a {@link SourceVersion} carries non-negative integer components.
 * The optional `label` is free text and never validated for shape. All checks
 * return issues; none throw.
 */

import { sourceError } from "../result";
import type { SourceIssue } from "../types";
import type { SourceVersion } from "../version";

function validatePart(value: number, name: string, issues: SourceIssue[]): void {
  if (!Number.isInteger(value) || value < 0) {
    issues.push(
      sourceError(
        "invalid_version_part",
        `Source version ${name} must be a non-negative integer`,
        `version.${name}`,
      ),
    );
  }
}

/** Validate that a version's numeric components are non-negative integers. */
export function validateSourceVersion(version: SourceVersion): SourceIssue[] {
  const issues: SourceIssue[] = [];
  validatePart(version.major, "major", issues);
  validatePart(version.minor, "minor", issues);
  validatePart(version.patch, "patch", issues);
  return issues;
}
