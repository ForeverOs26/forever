/**
 * Forever Project Readiness — evaluation validation.
 *
 * Structural guards over one {@link ReadinessEvaluation}: it must carry an
 * id, a coherent normalized requirement (with its effective necessity made
 * explicit — a described evaluation never leaves the demand implicit), a
 * known verdict, a reason in plain words, a coherent reference list (empty
 * only when nothing consulted was traceable), coherent finding ids, a known
 * subject standing when one is stated, and a non-empty timestamp when one is
 * stated. A structurally absent part is reported as missing, never
 * dereferenced. All checks return issues; none throw.
 */

import type { ReadinessEvaluation } from "../evaluation";
import { isAbsent, isNonEmptyString } from "../helpers";
import { readinessError } from "../types";
import type { ReadinessIssue } from "../types";
import { isKnownReadinessNecessity } from "../requirement";
import { isKnownReadinessSubjectStanding, isKnownReadinessVerdict } from "../verdict";
import { validateReadinessReference } from "./reference";
import { validateReadinessRequirement } from "./requirement";

/**
 * Validate one evaluation. `base` locates it; e.g. `evaluations.0`.
 *
 * Never throws: an evaluation so hostile it cannot even be read settles into
 * one structured issue.
 */
export function validateReadinessEvaluation(
  evaluation: ReadinessEvaluation,
  base = "evaluation",
): ReadinessIssue[] {
  try {
    return validateReadinessEvaluationUnguarded(evaluation, base);
  } catch {
    return [
      readinessError(
        "unvalidatable_input",
        "Evaluation behaved in a way that could not be validated",
        base,
      ),
    ];
  }
}

function validateReadinessEvaluationUnguarded(
  evaluation: ReadinessEvaluation,
  base: string,
): ReadinessIssue[] {
  if (isAbsent(evaluation)) {
    return [readinessError("missing_evaluation", "Evaluation is absent", base)];
  }
  const issues: ReadinessIssue[] = [];

  if (!isNonEmptyString(evaluation.id)) {
    issues.push(
      readinessError("missing_evaluation_id", "Evaluation is missing an id", `${base}.id`),
    );
  }
  if (isAbsent(evaluation.requirement)) {
    issues.push(
      readinessError(
        "missing_evaluation_requirement",
        "Evaluation judges no requirement",
        `${base}.requirement`,
      ),
    );
  } else {
    issues.push(...validateReadinessRequirement(evaluation.requirement, `${base}.requirement`));
    // A described evaluation makes the effective demand explicit: the
    // engine normalizes necessity at intake, so an implicit one here marks a
    // hand-built evaluation that skipped the safe-posture normalization.
    if (!isKnownReadinessNecessity(evaluation.requirement.necessity)) {
      issues.push(
        readinessError(
          "implicit_evaluation_necessity",
          "Evaluation's requirement leaves the necessity implicit — a described evaluation states it",
          `${base}.requirement.necessity`,
        ),
      );
    }
  }
  if (!isKnownReadinessVerdict(evaluation.verdict)) {
    issues.push(
      readinessError(
        "unknown_evaluation_verdict",
        `Evaluation has an unknown verdict "${String(evaluation.verdict)}"`,
        `${base}.verdict`,
      ),
    );
  }
  if (!isNonEmptyString(evaluation.reason)) {
    issues.push(
      readinessError("missing_evaluation_reason", "Evaluation states no reason", `${base}.reason`),
    );
  }

  if (!Array.isArray(evaluation.references)) {
    issues.push(
      readinessError(
        "invalid_evaluation_references",
        "Evaluation references must be a list",
        `${base}.references`,
      ),
    );
  } else {
    // Indexed — never a hole-skipping iterator — so an absent slot is
    // reported as a missing reference instead of vanishing silently.
    for (let index = 0; index < evaluation.references.length; index += 1) {
      issues.push(
        ...validateReadinessReference(evaluation.references[index], `${base}.references.${index}`),
      );
    }
  }

  if (evaluation.findingIds !== undefined) {
    if (!Array.isArray(evaluation.findingIds)) {
      issues.push(
        readinessError(
          "invalid_evaluation_findings",
          "Evaluation finding ids must be a list",
          `${base}.findingIds`,
        ),
      );
    } else {
      const seen = new Set<string>();
      for (let index = 0; index < evaluation.findingIds.length; index += 1) {
        const findingId = evaluation.findingIds[index];
        if (!isNonEmptyString(findingId)) {
          issues.push(
            readinessError(
              "empty_finding_reference",
              "Evaluation references an empty finding id",
              `${base}.findingIds.${index}`,
            ),
          );
          continue;
        }
        if (seen.has(findingId)) {
          issues.push(
            readinessError(
              "duplicate_finding_reference",
              `Evaluation references finding "${findingId}" more than once`,
              `${base}.findingIds.${index}`,
            ),
          );
        }
        seen.add(findingId);
      }
    }
  }

  if (evaluation.standing !== undefined && !isKnownReadinessSubjectStanding(evaluation.standing)) {
    issues.push(
      readinessError(
        "unknown_evaluation_standing",
        `Evaluation has an unknown subject standing "${String(evaluation.standing)}"`,
        `${base}.standing`,
      ),
    );
  }
  if (evaluation.evaluatedAt !== undefined && !isNonEmptyString(evaluation.evaluatedAt)) {
    issues.push(
      readinessError(
        "empty_evaluation_time",
        "Evaluation declares an empty evaluation time",
        `${base}.evaluatedAt`,
      ),
    );
  }

  return issues;
}
