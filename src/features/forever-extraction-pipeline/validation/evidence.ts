/**
 * Forever Extraction Pipeline — evidence validation.
 *
 * Structural guards over an {@link ExtractionEvidence}: the source reference
 * must be a non-empty id, the pinned revision — when present — must be a
 * well-formed reused RC4.4 version, the locator kind must be a known
 * vocabulary value with coherent positions (a 1-based page, a 0-based frame),
 * and the optional excerpt must be non-empty. When the fact the evidence
 * belongs to is known, a source or revision that disagrees with the fact's
 * own reference is flagged — evidence must point at the exact source and
 * revision the fact claims. All checks return issues; none throw.
 */

import type { ProjectSourceId } from "@/features/forever-project-sources";

import type { ExtractionEvidence } from "../evidence";
import { isKnownExtractionLocatorKind } from "../evidence";
import { isAbsent, isNonEmptyString } from "../helpers";
import { extractionError } from "../types";
import type { ExtractionIssue } from "../types";
import { compareExtractionVersion, type ExtractionSourceVersion } from "../version";
import { validateExtractionVersion } from "./version";

/** The fact-side references evidence is checked against, when known. */
export interface ExtractionEvidenceExpectation {
  sourceId?: ProjectSourceId;
  sourceVersion?: ExtractionSourceVersion;
}

/** Validate evidence's source reference, revision, locator, and excerpt. */
export function validateExtractionEvidence(
  evidence: ExtractionEvidence,
  expected: ExtractionEvidenceExpectation = {},
  base = "evidence",
): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];

  if (!isNonEmptyString(evidence.sourceId)) {
    issues.push(
      extractionError(
        "missing_evidence_source",
        "Extraction evidence names no catalogued source",
        `${base}.sourceId`,
      ),
    );
  } else if (
    expected.sourceId !== undefined &&
    isNonEmptyString(expected.sourceId) &&
    evidence.sourceId !== expected.sourceId
  ) {
    issues.push(
      extractionError(
        "evidence_source_mismatch",
        `Extraction evidence points at source "${evidence.sourceId}" but the fact claims "${expected.sourceId}"`,
        `${base}.sourceId`,
      ),
    );
  }

  if (!isAbsent(evidence.sourceVersion)) {
    issues.push(
      ...validateExtractionVersion(evidence.sourceVersion).map((issue) => ({
        ...issue,
        path: `${base}.sourceVersion`,
      })),
    );
    // A mismatch is only reportable when the comparison is a real number —
    // malformed parts compare to NaN and are already flagged by the reused
    // version guard, never double-reported as a fabricated mismatch.
    const comparison = isAbsent(expected.sourceVersion)
      ? 0
      : compareExtractionVersion(evidence.sourceVersion, expected.sourceVersion);
    if (Number.isFinite(comparison) && comparison !== 0) {
      issues.push(
        extractionError(
          "evidence_version_mismatch",
          "Extraction evidence pins a different source revision than the fact claims",
          `${base}.sourceVersion`,
        ),
      );
    }
  }

  const locator = evidence.locator;
  if (!isAbsent(locator)) {
    if (!isKnownExtractionLocatorKind(locator.kind)) {
      issues.push(
        extractionError(
          "unknown_locator_kind",
          `Extraction evidence has an unknown locator kind "${String(locator.kind)}"`,
          `${base}.locator.kind`,
        ),
      );
    }
    if (locator.page !== undefined && (!Number.isInteger(locator.page) || locator.page < 1)) {
      issues.push(
        extractionError(
          "invalid_locator_page",
          `Extraction evidence locator page "${String(locator.page)}" is not a positive integer`,
          `${base}.locator.page`,
        ),
      );
    }
    if (locator.frame !== undefined && (!Number.isInteger(locator.frame) || locator.frame < 0)) {
      issues.push(
        extractionError(
          "invalid_locator_frame",
          `Extraction evidence locator frame "${String(locator.frame)}" is not a non-negative integer`,
          `${base}.locator.frame`,
        ),
      );
    }
    if (locator.sheet !== undefined && !isNonEmptyString(locator.sheet)) {
      issues.push(
        extractionError(
          "empty_locator_sheet",
          "Extraction evidence locator declares an empty sheet",
          `${base}.locator.sheet`,
        ),
      );
    }
    if (locator.section !== undefined && !isNonEmptyString(locator.section)) {
      issues.push(
        extractionError(
          "empty_locator_section",
          "Extraction evidence locator declares an empty section",
          `${base}.locator.section`,
        ),
      );
    }
    if (locator.detail !== undefined && !isNonEmptyString(locator.detail)) {
      issues.push(
        extractionError(
          "empty_locator_detail",
          "Extraction evidence locator declares an empty detail",
          `${base}.locator.detail`,
        ),
      );
    }
  }

  if (evidence.excerpt !== undefined && !isNonEmptyString(evidence.excerpt)) {
    issues.push(
      extractionError(
        "empty_evidence_excerpt",
        "Extraction evidence declares an empty excerpt",
        `${base}.excerpt`,
      ),
    );
  }

  return issues;
}
