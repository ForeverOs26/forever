/**
 * Forever Project Sources — descriptor validation.
 *
 * Structural guards over a {@link ProjectSourceDescriptor}: the document type
 * and file format must be known vocabulary values, and the optional language
 * and dates — when present — must be non-empty and are flagged as warnings
 * when they do not match the conventional shapes (`en`/`en-GB`, ISO-8601
 * timestamp, `YYYY-MM-DD` date). Shape deviations warn rather than block, and
 * nothing is ever rewritten — RC4.4 reports, it does not mutate. All checks
 * return issues; none throw.
 */

import type { ProjectSourceDescriptor } from "../descriptor";
import { isKnownProjectSourceDocumentType, isKnownProjectSourceFileFormat } from "../descriptor";
import { isNonEmptyString } from "../helpers";
import { projectSourceError, projectSourceWarning } from "../types";
import type { ProjectSourceIssue } from "../types";

/** Conventional language-tag shape: `en`, `th`, `en-GB`. */
const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** Conventional ISO-8601 timestamp prefix: `2026-01-01T00:00:00`. */
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Conventional ISO calendar date: `2026-01-01`. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a descriptor's vocabularies and optional language and dates. */
export function validateProjectSourceDescriptor(
  descriptor: ProjectSourceDescriptor,
  base = "descriptor",
): ProjectSourceIssue[] {
  const issues: ProjectSourceIssue[] = [];
  if (!isKnownProjectSourceDocumentType(descriptor.documentType)) {
    issues.push(
      projectSourceError(
        "unknown_document_type",
        `Source descriptor has an unknown document type "${String(descriptor.documentType)}"`,
        `${base}.documentType`,
      ),
    );
  }
  if (!isKnownProjectSourceFileFormat(descriptor.fileFormat)) {
    issues.push(
      projectSourceError(
        "unknown_file_format",
        `Source descriptor has an unknown file format "${String(descriptor.fileFormat)}"`,
        `${base}.fileFormat`,
      ),
    );
  }
  if (descriptor.language !== undefined) {
    if (!isNonEmptyString(descriptor.language)) {
      issues.push(
        projectSourceError(
          "empty_language",
          "Source descriptor declares an empty language",
          `${base}.language`,
        ),
      );
    } else if (!LANGUAGE_PATTERN.test(descriptor.language)) {
      issues.push(
        projectSourceWarning(
          "unconventional_language",
          `Source language "${descriptor.language}" does not match the conventional tag shape`,
          `${base}.language`,
        ),
      );
    }
  }
  if (descriptor.uploadedAt !== undefined) {
    if (!isNonEmptyString(descriptor.uploadedAt)) {
      issues.push(
        projectSourceError(
          "empty_uploaded_at",
          "Source descriptor declares an empty upload timestamp",
          `${base}.uploadedAt`,
        ),
      );
    } else if (!ISO_DATE_TIME_PATTERN.test(descriptor.uploadedAt)) {
      issues.push(
        projectSourceWarning(
          "unconventional_uploaded_at",
          `Source upload timestamp "${descriptor.uploadedAt}" is not an ISO-8601 timestamp`,
          `${base}.uploadedAt`,
        ),
      );
    }
  }
  if (descriptor.documentDate !== undefined) {
    if (!isNonEmptyString(descriptor.documentDate)) {
      issues.push(
        projectSourceError(
          "empty_document_date",
          "Source descriptor declares an empty document date",
          `${base}.documentDate`,
        ),
      );
    } else if (!ISO_DATE_PATTERN.test(descriptor.documentDate)) {
      issues.push(
        projectSourceWarning(
          "unconventional_document_date",
          `Source document date "${descriptor.documentDate}" is not an ISO YYYY-MM-DD date`,
          `${base}.documentDate`,
        ),
      );
    }
  }
  return issues;
}
