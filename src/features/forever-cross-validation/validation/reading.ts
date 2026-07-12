/**
 * Forever Cross-Source Validation — reading validation.
 *
 * Structural guards over one {@link CrossSourceReading}: it must reference a
 * fact and a source, pin a well-formed received revision, carry a comparable
 * signature and a coherent confidence (the reused RC4.5 confidence guard —
 * never a local restatement), and its registered attribution must be
 * coherent: an authority or source status on an *unregistered* reading is a
 * fabricated attribution and is reported as one. A structurally absent part
 * is reported as missing, never dereferenced. All checks return issues; none
 * throw.
 */

import { validateExtractionConfidence } from "@/features/forever-extraction-pipeline";
import {
  validateProjectSourceAuthority,
  validateProjectSourceStatus,
} from "@/features/forever-project-sources";

import { isAbsent, isNonEmptyString } from "../helpers";
import type { CrossSourceReading } from "../reading";
import { crossValidationError } from "../types";
import type { CrossValidationIssue } from "../types";
import { isWellFormedCrossValidationSourceVersion } from "../version";

/** Validate one cross-source reading. `base` locates it; e.g. `readings.0`. */
export function validateCrossSourceReading(
  reading: CrossSourceReading,
  base = "reading",
): CrossValidationIssue[] {
  if (isAbsent(reading)) {
    return [crossValidationError("missing_reading", "Cross-source reading is absent", base)];
  }
  const issues: CrossValidationIssue[] = [];

  if (!isNonEmptyString(reading.factId)) {
    issues.push(
      crossValidationError(
        "missing_reading_fact",
        "Reading references no extracted fact",
        `${base}.factId`,
      ),
    );
  }
  if (!isNonEmptyString(reading.sourceId)) {
    issues.push(
      crossValidationError(
        "missing_reading_source",
        "Reading references no catalogued source",
        `${base}.sourceId`,
      ),
    );
  }
  if (!isWellFormedCrossValidationSourceVersion(reading.sourceVersion)) {
    issues.push(
      crossValidationError(
        "invalid_reading_version",
        "Reading pins no well-formed received revision",
        `${base}.sourceVersion`,
      ),
    );
  }
  if (typeof reading.signature !== "string") {
    issues.push(
      crossValidationError(
        "missing_reading_signature",
        "Reading carries no comparable value signature",
        `${base}.signature`,
      ),
    );
  }
  if (reading.unit !== undefined && !isNonEmptyString(reading.unit)) {
    issues.push(
      crossValidationError("empty_reading_unit", "Reading declares an empty unit", `${base}.unit`),
    );
  }
  if (reading.currency !== undefined && !isNonEmptyString(reading.currency)) {
    issues.push(
      crossValidationError(
        "empty_reading_currency",
        "Reading declares an empty currency",
        `${base}.currency`,
      ),
    );
  }
  if (reading.language !== undefined && !isNonEmptyString(reading.language)) {
    issues.push(
      crossValidationError(
        "empty_reading_language",
        "Reading declares an empty language",
        `${base}.language`,
      ),
    );
  }

  if (isAbsent(reading.confidence)) {
    issues.push(
      crossValidationError(
        "missing_reading_confidence",
        "Reading carries no confidence — an unassessed confidence must be the explicit unknown grade",
        `${base}.confidence`,
      ),
    );
  } else {
    issues.push(...validateExtractionConfidence(reading.confidence, `${base}.confidence`));
  }

  if (typeof reading.current !== "boolean") {
    issues.push(
      crossValidationError(
        "invalid_reading_current",
        "Reading does not state whether it is current",
        `${base}.current`,
      ),
    );
  }
  if (typeof reading.statesAbsence !== "boolean") {
    issues.push(
      crossValidationError(
        "invalid_reading_absence",
        "Reading does not state whether it states an absence",
        `${base}.statesAbsence`,
      ),
    );
  }
  if (typeof reading.registered !== "boolean") {
    issues.push(
      crossValidationError(
        "invalid_reading_registered",
        "Reading does not state whether its source is registered",
        `${base}.registered`,
      ),
    );
  }

  if (reading.authority !== undefined) {
    issues.push(...validateProjectSourceAuthority(reading.authority, `${base}.authority`));
    if (reading.registered === false) {
      issues.push(
        crossValidationError(
          "fabricated_reading_authority",
          "Reading carries an authority although its source is not registered — an unresolvable attribution must stay absent",
          `${base}.authority`,
        ),
      );
    }
  }
  if (reading.sourceStatus !== undefined) {
    issues.push(...validateProjectSourceStatus(reading.sourceStatus, `${base}.sourceStatus`));
    if (reading.registered === false) {
      issues.push(
        crossValidationError(
          "fabricated_reading_status",
          "Reading carries a source status although its source is not registered — an unresolvable standing must stay absent",
          `${base}.sourceStatus`,
        ),
      );
    }
  }

  return issues;
}
