/**
 * Forever Cross-Source Validation — standing validation.
 *
 * Structural guards over one {@link CrossFactStanding}: the admissibility
 * must be a known vocabulary value, an examinable standing must name its
 * fact, a standing that requires review must reference at least one finding
 * that justifies it, and an inadmissible standing should state why. A
 * structurally absent part is reported as missing, never dereferenced. All
 * checks return issues; none throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import type { CrossFactStanding } from "../standing";
import { isKnownCrossFactAdmissibility } from "../standing";
import { crossValidationError, crossValidationWarning } from "../types";
import type { CrossValidationIssue } from "../types";

/** Validate one fact standing. `base` locates it; e.g. `standings.0`. */
export function validateCrossFactStanding(
  standing: CrossFactStanding,
  base = "standing",
): CrossValidationIssue[] {
  if (isAbsent(standing)) {
    return [crossValidationError("missing_standing", "Fact standing is absent", base)];
  }
  const issues: CrossValidationIssue[] = [];

  if (!isKnownCrossFactAdmissibility(standing.admissibility)) {
    issues.push(
      crossValidationError(
        "unknown_admissibility",
        `Standing has an unknown admissibility "${String(standing.admissibility)}"`,
        `${base}.admissibility`,
      ),
    );
  }
  // An inadmissible slot may have been too malformed to carry a usable id at
  // all; every examinable standing must name the fact it stands for.
  if (!isNonEmptyString(standing.factId) && standing.admissibility !== "inadmissible") {
    issues.push(
      crossValidationError(
        "missing_standing_fact",
        "Standing names no examined fact",
        `${base}.factId`,
      ),
    );
  }
  if (standing.subjectKey !== undefined && !isNonEmptyString(standing.subjectKey)) {
    issues.push(
      crossValidationError(
        "empty_standing_subject",
        "Standing declares an empty subject key",
        `${base}.subjectKey`,
      ),
    );
  }

  if (!Array.isArray(standing.findingIds)) {
    issues.push(
      crossValidationError(
        "invalid_standing_findings",
        "Standing finding ids must be a list",
        `${base}.findingIds`,
      ),
    );
  } else {
    standing.findingIds.forEach((findingId, index) => {
      if (!isNonEmptyString(findingId)) {
        issues.push(
          crossValidationError(
            "empty_finding_reference",
            "Standing references an empty finding id",
            `${base}.findingIds.${index}`,
          ),
        );
      }
    });
    if (standing.admissibility === "requires_review" && standing.findingIds.length === 0) {
      issues.push(
        crossValidationError(
          "unjustified_review",
          "Standing requires review but references no finding justifying it",
          `${base}.findingIds`,
        ),
      );
    }
  }

  if (standing.admissibility === "inadmissible" && !isNonEmptyString(standing.reason)) {
    issues.push(
      crossValidationWarning(
        "inadmissible_without_reason",
        "Standing is inadmissible but states no reason",
        `${base}.reason`,
      ),
    );
  }

  return issues;
}
