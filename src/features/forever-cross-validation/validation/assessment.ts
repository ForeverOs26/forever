/**
 * Forever Cross-Source Validation — assessment validation.
 *
 * Structural guards over one {@link CrossValidationAssessment}: the subject
 * must be coherent (a key derived by the reused RC4.5 subject rule, a
 * project, a known fact type), every reading must be individually coherent
 * with no fact referenced twice, the consensus must be a known vocabulary
 * value, and the consensus must be *possible* for the readings shown — an
 * `unaddressed` subject cannot show a current reading, and a `corroborated`
 * or `contested` subject must show the readings that could reach that
 * verdict. A structurally absent part is reported as missing, never
 * dereferenced. All checks return issues; none throw.
 */

import type { ExtractionFact } from "@/features/forever-extraction-pipeline";
import {
  extractionFactSubjectKey,
  isKnownExtractionFactType,
} from "@/features/forever-extraction-pipeline";

import type { CrossValidationAssessment } from "../assessment";
import { isKnownCrossValidationConsensus, listCurrentCrossSourceReadings } from "../assessment";
import { isAbsent, isNonEmptyString } from "../helpers";
import type { CrossValidationSubject } from "../subject";
import { crossValidationError } from "../types";
import type { CrossValidationIssue } from "../types";
import { validateCrossSourceReading } from "./reading";

function validateSubject(subject: CrossValidationSubject, base: string): CrossValidationIssue[] {
  if (isAbsent(subject)) {
    return [crossValidationError("missing_subject", "Assessment names no subject", base)];
  }
  const issues: CrossValidationIssue[] = [];
  if (!isNonEmptyString(subject.key)) {
    issues.push(
      crossValidationError("missing_subject_key", "Subject carries no key", `${base}.key`),
    );
  }
  if (!isNonEmptyString(subject.projectId)) {
    issues.push(
      crossValidationError(
        "missing_subject_project",
        "Subject names no canonical project",
        `${base}.projectId`,
      ),
    );
  }
  if (!isKnownExtractionFactType(subject.factType)) {
    issues.push(
      crossValidationError(
        "unknown_subject_fact_type",
        `Subject has an unknown fact type "${String(subject.factType)}"`,
        `${base}.factType`,
      ),
    );
  }
  if (subject.fieldPath !== undefined && !isNonEmptyString(subject.fieldPath)) {
    issues.push(
      crossValidationError(
        "empty_subject_path",
        "Subject declares an empty field path",
        `${base}.fieldPath`,
      ),
    );
  }
  // Key coherence: the key must be what the reused RC4.5 rule derives from
  // the parts — a drifted key would detach the assessment from its facts.
  if (
    isNonEmptyString(subject.key) &&
    isNonEmptyString(subject.projectId) &&
    typeof subject.factType === "string" &&
    (subject.fieldPath === undefined || typeof subject.fieldPath === "string")
  ) {
    const expected = extractionFactSubjectKey({
      projectId: subject.projectId,
      factType: subject.factType,
      fieldPath: subject.fieldPath,
    } as ExtractionFact);
    if (subject.key !== expected) {
      issues.push(
        crossValidationError(
          "incoherent_subject_key",
          `Subject key "${subject.key}" does not match its parts "${expected}"`,
          `${base}.key`,
        ),
      );
    }
  }
  return issues;
}

/** Validate one assessment. `base` locates it; e.g. `subjects.0`. */
export function validateCrossValidationAssessment(
  assessment: CrossValidationAssessment,
  base = "assessment",
): CrossValidationIssue[] {
  if (isAbsent(assessment)) {
    return [crossValidationError("missing_assessment", "Subject assessment is absent", base)];
  }
  const issues: CrossValidationIssue[] = [];

  issues.push(...validateSubject(assessment.subject, `${base}.subject`));

  let currentCount = 0;
  let distinctSources = 0;
  if (!Array.isArray(assessment.readings)) {
    issues.push(
      crossValidationError(
        "invalid_assessment_readings",
        "Assessment readings must be a list",
        `${base}.readings`,
      ),
    );
  } else {
    const seenFactIds = new Set<string>();
    assessment.readings.forEach((reading, index) => {
      issues.push(...validateCrossSourceReading(reading, `${base}.readings.${index}`));
      if (!isAbsent(reading) && isNonEmptyString(reading.factId)) {
        if (seenFactIds.has(reading.factId)) {
          issues.push(
            crossValidationError(
              "duplicate_reading_fact",
              `Fact "${reading.factId}" is read more than once in this assessment`,
              `${base}.readings.${index}.factId`,
            ),
          );
        }
        seenFactIds.add(reading.factId);
      }
    });
    currentCount = listCurrentCrossSourceReadings(assessment.readings).length;
    distinctSources = new Set(
      listCurrentCrossSourceReadings(assessment.readings).map((reading) => reading?.sourceId),
    ).size;
  }

  if (!isKnownCrossValidationConsensus(assessment.consensus)) {
    issues.push(
      crossValidationError(
        "unknown_consensus",
        `Assessment has an unknown consensus "${String(assessment.consensus)}"`,
        `${base}.consensus`,
      ),
    );
  } else if (Array.isArray(assessment.readings)) {
    // Consensus possibility: what an assessment claims must be reachable
    // from the readings it shows.
    if (assessment.consensus === "unaddressed" && currentCount > 0) {
      issues.push(
        crossValidationError(
          "incoherent_consensus",
          "Assessment is unaddressed but shows a current reading",
          `${base}.consensus`,
        ),
      );
    }
    if (
      (assessment.consensus === "contested" ||
        assessment.consensus === "corroborated" ||
        assessment.consensus === "incomparable" ||
        assessment.consensus === "uncorroborated") &&
      currentCount === 0
    ) {
      issues.push(
        crossValidationError(
          "incoherent_consensus",
          `Assessment is ${assessment.consensus} but shows no current reading`,
          `${base}.consensus`,
        ),
      );
    }
    if (assessment.consensus === "corroborated" && distinctSources < 2) {
      issues.push(
        crossValidationError(
          "incoherent_consensus",
          "Assessment is corroborated but shows fewer than two distinct current sources",
          `${base}.consensus`,
        ),
      );
    }
    if (assessment.consensus === "contested" && currentCount < 2) {
      issues.push(
        crossValidationError(
          "incoherent_consensus",
          "Assessment is contested but shows fewer than two current readings",
          `${base}.consensus`,
        ),
      );
    }
  }

  if (!Array.isArray(assessment.findingIds)) {
    issues.push(
      crossValidationError(
        "invalid_assessment_findings",
        "Assessment finding ids must be a list",
        `${base}.findingIds`,
      ),
    );
  } else {
    assessment.findingIds.forEach((findingId, index) => {
      if (!isNonEmptyString(findingId)) {
        issues.push(
          crossValidationError(
            "empty_finding_reference",
            "Assessment references an empty finding id",
            `${base}.findingIds.${index}`,
          ),
        );
      }
    });
  }

  return issues;
}
