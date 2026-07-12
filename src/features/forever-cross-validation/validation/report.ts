/**
 * Forever Cross-Source Validation — report validation.
 *
 * Structural guards over one {@link CrossValidationReport}: the identity
 * references must be present, every assessment, finding, and standing must be
 * individually coherent, no subject key or finding id may repeat, every
 * finding must belong to the report's project and anchor to a subject the
 * report assesses, every finding id an assessment or standing references must
 * exist, and a standing that requires review must be justified by a finding
 * that actually requires it. A structurally absent part is reported as
 * missing, never dereferenced. All checks return issues; none throw.
 */

import { crossValidationFindingRequiresReview } from "../finding";
import { isAbsent, isNonEmptyString } from "../helpers";
import type { CrossValidationReport } from "../report";
import { crossValidationError } from "../types";
import type { CrossValidationIssue } from "../types";
import { validateCrossValidationAssessment } from "./assessment";
import { validateCrossValidationFinding } from "./finding";
import { validateCrossFactStanding } from "./standing";

function at(base: string, path: string): string {
  return base === "" ? path : `${base}.${path}`;
}

/** Validate a whole report. `base` locates it; empty when standalone. */
export function validateCrossValidationReport(
  report: CrossValidationReport,
  base = "",
): CrossValidationIssue[] {
  if (isAbsent(report)) {
    return [
      crossValidationError(
        "missing_report",
        "Cross-validation report is absent",
        base === "" ? "report" : base,
      ),
    ];
  }
  const issues: CrossValidationIssue[] = [];

  if (!isNonEmptyString(report.id)) {
    issues.push(
      crossValidationError("missing_report_id", "Report is missing an id", at(base, "id")),
    );
  }
  if (!isNonEmptyString(report.projectId)) {
    issues.push(
      crossValidationError(
        "missing_report_project",
        "Report names no canonical project",
        at(base, "projectId"),
      ),
    );
  }
  if (!isNonEmptyString(report.projectSlug)) {
    issues.push(
      crossValidationError(
        "missing_report_slug",
        "Report carries no project slug",
        at(base, "projectSlug"),
      ),
    );
  }
  if (report.batch !== undefined && !isNonEmptyString(report.batch)) {
    issues.push(
      crossValidationError(
        "empty_report_batch",
        "Report declares an empty batch discriminator",
        at(base, "batch"),
      ),
    );
  }
  if (report.describedAt !== undefined && !isNonEmptyString(report.describedAt)) {
    issues.push(
      crossValidationError(
        "empty_report_time",
        "Report declares an empty description time",
        at(base, "describedAt"),
      ),
    );
  }

  const subjectKeys = new Set<string>();
  if (!Array.isArray(report.subjects)) {
    issues.push(
      crossValidationError(
        "invalid_report_subjects",
        "Report subjects must be a list",
        at(base, "subjects"),
      ),
    );
  } else {
    report.subjects.forEach((assessment, index) => {
      issues.push(...validateCrossValidationAssessment(assessment, at(base, `subjects.${index}`)));
      const key = assessment?.subject?.key;
      if (isNonEmptyString(key)) {
        if (subjectKeys.has(key)) {
          issues.push(
            crossValidationError(
              "duplicate_subject_key",
              `Report assesses the subject "${key}" more than once`,
              at(base, `subjects.${index}.subject.key`),
            ),
          );
        }
        subjectKeys.add(key);
      }
    });
  }

  const findingIds = new Set<string>();
  const reviewFindingIds = new Set<string>();
  if (!Array.isArray(report.findings)) {
    issues.push(
      crossValidationError(
        "invalid_report_findings",
        "Report findings must be a list",
        at(base, "findings"),
      ),
    );
  } else {
    report.findings.forEach((finding, index) => {
      issues.push(...validateCrossValidationFinding(finding, at(base, `findings.${index}`)));
      if (isAbsent(finding)) return;
      if (isNonEmptyString(finding.id)) {
        if (findingIds.has(finding.id)) {
          issues.push(
            crossValidationError(
              "duplicate_finding_id",
              `Report describes the finding id "${finding.id}" more than once`,
              at(base, `findings.${index}.id`),
            ),
          );
        }
        findingIds.add(finding.id);
        if (crossValidationFindingRequiresReview(finding)) reviewFindingIds.add(finding.id);
      }
      if (
        isNonEmptyString(finding.projectId) &&
        isNonEmptyString(report.projectId) &&
        finding.projectId !== report.projectId
      ) {
        issues.push(
          crossValidationError(
            "foreign_finding",
            `Finding belongs to "${finding.projectId}", not "${report.projectId}"`,
            at(base, `findings.${index}.projectId`),
          ),
        );
      }
      if (
        Array.isArray(report.subjects) &&
        isNonEmptyString(finding.subjectKey) &&
        !subjectKeys.has(finding.subjectKey)
      ) {
        issues.push(
          crossValidationError(
            "unanchored_finding",
            `Finding is about subject "${finding.subjectKey}", which the report does not assess`,
            at(base, `findings.${index}.subjectKey`),
          ),
        );
      }
    });
  }

  // Assessments may only reference findings the report actually describes.
  if (Array.isArray(report.subjects) && Array.isArray(report.findings)) {
    report.subjects.forEach((assessment, index) => {
      if (isAbsent(assessment) || !Array.isArray(assessment.findingIds)) return;
      assessment.findingIds.forEach((findingId, findingIndex) => {
        if (isNonEmptyString(findingId) && !findingIds.has(findingId)) {
          issues.push(
            crossValidationError(
              "unknown_finding_reference",
              `Assessment references finding "${findingId}", which the report does not describe`,
              at(base, `subjects.${index}.findingIds.${findingIndex}`),
            ),
          );
        }
      });
    });
  }

  if (!Array.isArray(report.standings)) {
    issues.push(
      crossValidationError(
        "invalid_report_standings",
        "Report standings must be a list",
        at(base, "standings"),
      ),
    );
  } else {
    report.standings.forEach((standing, index) => {
      issues.push(...validateCrossFactStanding(standing, at(base, `standings.${index}`)));
      if (isAbsent(standing) || !Array.isArray(standing.findingIds)) return;
      standing.findingIds.forEach((findingId, findingIndex) => {
        if (
          Array.isArray(report.findings) &&
          isNonEmptyString(findingId) &&
          !findingIds.has(findingId)
        ) {
          issues.push(
            crossValidationError(
              "unknown_finding_reference",
              `Standing references finding "${findingId}", which the report does not describe`,
              at(base, `standings.${index}.findingIds.${findingIndex}`),
            ),
          );
        }
      });
      // A review verdict must be justified by a finding that requires review.
      if (
        Array.isArray(report.findings) &&
        standing.admissibility === "requires_review" &&
        !standing.findingIds.some((findingId) => reviewFindingIds.has(findingId))
      ) {
        issues.push(
          crossValidationError(
            "unjustified_review",
            "Standing requires review but none of its findings requires it",
            at(base, `standings.${index}.findingIds`),
          ),
        );
      }
    });
  }

  if (!Array.isArray(report.sourceIds)) {
    issues.push(
      crossValidationError(
        "invalid_report_sources",
        "Report source ids must be a list",
        at(base, "sourceIds"),
      ),
    );
  } else {
    const seenSources = new Set<string>();
    report.sourceIds.forEach((sourceId, index) => {
      if (!isNonEmptyString(sourceId)) {
        issues.push(
          crossValidationError(
            "empty_source_reference",
            "Report references an empty source id",
            at(base, `sourceIds.${index}`),
          ),
        );
        return;
      }
      if (seenSources.has(sourceId)) {
        issues.push(
          crossValidationError(
            "duplicate_source_reference",
            `Report references source "${sourceId}" more than once`,
            at(base, `sourceIds.${index}`),
          ),
        );
      }
      seenSources.add(sourceId);
    });
  }

  return issues;
}
