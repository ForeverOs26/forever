/**
 * Forever Project Readiness — reference validation.
 *
 * Structural guards over one {@link ReadinessReference} (the reused RC4.7
 * reference shape): a reference must point at *something* — an RC4.5 fact,
 * an RC4.4 source, or a canonical path — every stated part must be a
 * non-empty string, and a pinned revision must be the reused well-formed
 * version shape. A structurally absent part is reported as missing, never
 * dereferenced. All checks return issues; none throw.
 */

import type { ReadinessReference } from "../evaluation";
import { isAbsent, isNonEmptyString } from "../helpers";
import { readinessError } from "../types";
import type { ReadinessIssue } from "../types";
import { isWellFormedReadinessSourceVersion } from "../version";

/**
 * Validate one reference. `base` locates it; e.g. `references.0`.
 *
 * Never throws: a reference so hostile it cannot even be read settles into
 * one structured issue.
 */
export function validateReadinessReference(
  reference: ReadinessReference,
  base = "reference",
): ReadinessIssue[] {
  try {
    return validateReadinessReferenceUnguarded(reference, base);
  } catch {
    return [
      readinessError(
        "unvalidatable_input",
        "Reference behaved in a way that could not be validated",
        base,
      ),
    ];
  }
}

function validateReadinessReferenceUnguarded(
  reference: ReadinessReference,
  base: string,
): ReadinessIssue[] {
  if (isAbsent(reference)) {
    return [readinessError("missing_reference", "Reference is absent", base)];
  }
  const issues: ReadinessIssue[] = [];

  if (reference.factId !== undefined && !isNonEmptyString(reference.factId)) {
    issues.push(
      readinessError(
        "empty_reference_fact",
        "Reference declares an empty fact id",
        `${base}.factId`,
      ),
    );
  }
  if (reference.sourceId !== undefined && !isNonEmptyString(reference.sourceId)) {
    issues.push(
      readinessError(
        "empty_reference_source",
        "Reference declares an empty source id",
        `${base}.sourceId`,
      ),
    );
  }
  if (reference.path !== undefined && !isNonEmptyString(reference.path)) {
    issues.push(
      readinessError("empty_reference_path", "Reference declares an empty path", `${base}.path`),
    );
  }
  if (
    reference.sourceVersion !== undefined &&
    !isWellFormedReadinessSourceVersion(reference.sourceVersion)
  ) {
    issues.push(
      readinessError(
        "malformed_reference_version",
        "Reference pins a malformed source revision",
        `${base}.sourceVersion`,
      ),
    );
  }
  if (
    reference.factId === undefined &&
    reference.sourceId === undefined &&
    reference.path === undefined
  ) {
    issues.push(
      readinessError(
        "empty_reference",
        "Reference points at nothing — no fact, source, or path",
        base,
      ),
    );
  }

  return issues;
}
