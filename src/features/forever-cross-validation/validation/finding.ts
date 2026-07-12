/**
 * Forever Cross-Source Validation — finding validation.
 *
 * Structural guards over one {@link CrossValidationFinding}: it must carry an
 * id, a known kind, a known disposition, a project, and a message; an
 * inconsistency must say which dimension it is about; a missing-information
 * finding must name the path it found missing; and — the module's
 * traceability mandate — every finding about facts must reference at least
 * one, with every reference naming at least one of a fact, a source, or a
 * path, so a finding can always be traced back to what it is about. A
 * structurally absent part is reported as missing, never dereferenced. All
 * checks return issues; none throw.
 */

import type { CrossValidationFinding, CrossValidationReference } from "../finding";
import {
  isKnownCrossValidationDimension,
  isKnownCrossValidationDisposition,
  isKnownCrossValidationFindingKind,
} from "../finding";
import { isAbsent, isNonEmptyString } from "../helpers";
import { crossValidationError } from "../types";
import type { CrossValidationIssue } from "../types";
import { isWellFormedCrossValidationSourceVersion } from "../version";

function validateReference(
  reference: CrossValidationReference,
  base: string,
): CrossValidationIssue[] {
  if (isAbsent(reference)) {
    return [crossValidationError("missing_finding_reference", "Finding reference is absent", base)];
  }
  const issues: CrossValidationIssue[] = [];
  if (reference.factId !== undefined && !isNonEmptyString(reference.factId)) {
    issues.push(
      crossValidationError(
        "empty_reference_fact",
        "Finding reference declares an empty fact id",
        `${base}.factId`,
      ),
    );
  }
  if (reference.sourceId !== undefined && !isNonEmptyString(reference.sourceId)) {
    issues.push(
      crossValidationError(
        "empty_reference_source",
        "Finding reference declares an empty source id",
        `${base}.sourceId`,
      ),
    );
  }
  if (
    reference.sourceVersion !== undefined &&
    !isWellFormedCrossValidationSourceVersion(reference.sourceVersion)
  ) {
    issues.push(
      crossValidationError(
        "invalid_reference_version",
        "Finding reference pins a malformed source revision",
        `${base}.sourceVersion`,
      ),
    );
  }
  if (reference.path !== undefined && !isNonEmptyString(reference.path)) {
    issues.push(
      crossValidationError(
        "empty_reference_path",
        "Finding reference declares an empty path",
        `${base}.path`,
      ),
    );
  }
  if (
    reference.factId === undefined &&
    reference.sourceId === undefined &&
    reference.path === undefined
  ) {
    issues.push(
      crossValidationError(
        "empty_finding_reference",
        "Finding reference names no fact, source, or path — it traces to nothing",
        base,
      ),
    );
  }
  return issues;
}

/** Validate one finding. `base` locates it; e.g. `findings.0`. */
export function validateCrossValidationFinding(
  finding: CrossValidationFinding,
  base = "finding",
): CrossValidationIssue[] {
  if (isAbsent(finding)) {
    return [crossValidationError("missing_finding", "Validation finding is absent", base)];
  }
  const issues: CrossValidationIssue[] = [];

  if (!isNonEmptyString(finding.id)) {
    issues.push(
      crossValidationError("missing_finding_id", "Finding is missing an id", `${base}.id`),
    );
  }
  if (!isKnownCrossValidationFindingKind(finding.kind)) {
    issues.push(
      crossValidationError(
        "unknown_finding_kind",
        `Finding has an unknown kind "${String(finding.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  if (!isKnownCrossValidationDisposition(finding.disposition)) {
    issues.push(
      crossValidationError(
        "unknown_finding_disposition",
        `Finding has an unknown disposition "${String(finding.disposition)}"`,
        `${base}.disposition`,
      ),
    );
  }
  if (!isNonEmptyString(finding.projectId)) {
    issues.push(
      crossValidationError(
        "missing_finding_project",
        "Finding names no canonical project",
        `${base}.projectId`,
      ),
    );
  }
  if (!isNonEmptyString(finding.message)) {
    issues.push(
      crossValidationError(
        "missing_finding_message",
        "Finding states no message",
        `${base}.message`,
      ),
    );
  }
  if (finding.subjectKey !== undefined && !isNonEmptyString(finding.subjectKey)) {
    issues.push(
      crossValidationError(
        "empty_finding_subject",
        "Finding declares an empty subject key",
        `${base}.subjectKey`,
      ),
    );
  }
  if (finding.path !== undefined && !isNonEmptyString(finding.path)) {
    issues.push(
      crossValidationError("empty_finding_path", "Finding declares an empty path", `${base}.path`),
    );
  }
  if (finding.dimension !== undefined && !isKnownCrossValidationDimension(finding.dimension)) {
    issues.push(
      crossValidationError(
        "unknown_finding_dimension",
        `Finding has an unknown dimension "${String(finding.dimension)}"`,
        `${base}.dimension`,
      ),
    );
  }
  if (finding.kind === "inconsistency" && finding.dimension === undefined) {
    issues.push(
      crossValidationError(
        "inconsistency_without_dimension",
        "Inconsistency finding says not which dimension is inconsistent",
        `${base}.dimension`,
      ),
    );
  }
  if (finding.kind === "missing_information" && !isNonEmptyString(finding.path)) {
    issues.push(
      crossValidationError(
        "missing_information_without_path",
        "Missing-information finding names no path it found missing",
        `${base}.path`,
      ),
    );
  }
  if (finding.detectedAt !== undefined && !isNonEmptyString(finding.detectedAt)) {
    issues.push(
      crossValidationError(
        "empty_finding_time",
        "Finding declares an empty detection time",
        `${base}.detectedAt`,
      ),
    );
  }

  if (!Array.isArray(finding.references)) {
    issues.push(
      crossValidationError(
        "invalid_finding_references",
        "Finding references must be a list",
        `${base}.references`,
      ),
    );
  } else {
    finding.references.forEach((reference, index) => {
      issues.push(...validateReference(reference, `${base}.references.${index}`));
    });
    // The traceability mandate: every finding must trace back to what it is
    // about. A missing-information finding may trace by path alone; every
    // other kind is about concrete readings and must reference at least one.
    if (finding.references.length === 0) {
      issues.push(
        crossValidationError(
          "untraceable_finding",
          "Finding references nothing — it cannot be traced back to sources, facts, or paths",
          `${base}.references`,
        ),
      );
    }
  }

  return issues;
}
