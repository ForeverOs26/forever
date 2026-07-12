/**
 * Forever Cross-Source Validation — requirements validation.
 *
 * Structural guards over one {@link CrossValidationRequirements}: every
 * stated bar must be a known vocabulary value (the reused RC3.3 trust ladder
 * and RC4.5 confidence ladder — never local variants), the corroboration and
 * evidence demands must be booleans, and every expected path must be a
 * non-empty string. An absent requirements value is valid — nothing is
 * demanded by default, and validation never fabricates a bar. All checks
 * return issues; none throw.
 */

import { isKnownCrossSourceTrustLevel } from "../authority";
import { isAbsent, isNonEmptyString } from "../helpers";
import type { CrossValidationRequirements } from "../requirements";
import { crossValidationError, isKnownCrossValidationConfidenceLevel } from "../types";
import type { CrossValidationIssue } from "../types";

/** Validate stated requirements. `base` locates them; e.g. `requirements`. */
export function validateCrossValidationRequirements(
  requirements: CrossValidationRequirements | undefined,
  base = "requirements",
): CrossValidationIssue[] {
  // Absent requirements demand nothing — the stated default, not a defect.
  if (requirements === undefined) return [];
  if (isAbsent(requirements) || typeof requirements !== "object") {
    return [
      crossValidationError(
        "invalid_requirements",
        "Requirements must be an object when stated",
        base,
      ),
    ];
  }
  const issues: CrossValidationIssue[] = [];

  if (
    requirements.minimumTrust !== undefined &&
    !isKnownCrossSourceTrustLevel(requirements.minimumTrust)
  ) {
    issues.push(
      crossValidationError(
        "unknown_required_trust",
        `Requirements demand an unknown trust level "${String(requirements.minimumTrust)}"`,
        `${base}.minimumTrust`,
      ),
    );
  }
  if (
    requirements.minimumConfidence !== undefined &&
    !isKnownCrossValidationConfidenceLevel(requirements.minimumConfidence)
  ) {
    issues.push(
      crossValidationError(
        "unknown_required_confidence",
        `Requirements demand an unknown confidence level "${String(requirements.minimumConfidence)}"`,
        `${base}.minimumConfidence`,
      ),
    );
  }
  if (
    requirements.requireIndependentCorroboration !== undefined &&
    typeof requirements.requireIndependentCorroboration !== "boolean"
  ) {
    issues.push(
      crossValidationError(
        "invalid_corroboration_requirement",
        "Corroboration requirement must be a boolean when stated",
        `${base}.requireIndependentCorroboration`,
      ),
    );
  }
  if (
    requirements.requireLocatedEvidence !== undefined &&
    typeof requirements.requireLocatedEvidence !== "boolean"
  ) {
    issues.push(
      crossValidationError(
        "invalid_evidence_requirement",
        "Evidence requirement must be a boolean when stated",
        `${base}.requireLocatedEvidence`,
      ),
    );
  }
  if (requirements.expectedPaths !== undefined) {
    if (!Array.isArray(requirements.expectedPaths)) {
      issues.push(
        crossValidationError(
          "invalid_expected_paths",
          "Expected paths must be a list when stated",
          `${base}.expectedPaths`,
        ),
      );
    } else {
      requirements.expectedPaths.forEach((path, index) => {
        if (!isNonEmptyString(path)) {
          issues.push(
            crossValidationError(
              "invalid_expected_path",
              "Expected path must be a non-empty string",
              `${base}.expectedPaths.${index}`,
            ),
          );
        }
      });
    }
  }

  return issues;
}
