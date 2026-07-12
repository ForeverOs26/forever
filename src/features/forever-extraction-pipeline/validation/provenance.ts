/**
 * Forever Extraction Pipeline — provenance validation.
 *
 * The guards that make provenance mandatory: a fact's chain must name the
 * catalogued source, pin the exact received revision (the reused RC4.4
 * version guard judges its shape), describe the extraction method, and carry
 * the caller-supplied extraction time — a missing link is reported, never
 * repaired or fabricated. When the fact the provenance belongs to is known, a
 * source or revision that disagrees with the fact's own reference is flagged,
 * and a derivation chain pointing a fact at itself is an error. Shape
 * deviations in the timestamp warn rather than block, mirroring the RC4.4
 * descriptor guard. All checks return issues; none throw.
 */

import type { ProjectSourceId } from "@/features/forever-project-sources";

import { isAbsent, isNonEmptyString } from "../helpers";
import type { ExtractionProvenance } from "../provenance";
import { extractionError, extractionWarning } from "../types";
import type { ExtractionFactId, ExtractionIssue } from "../types";
import { compareExtractionVersion, type ExtractionSourceVersion } from "../version";
import { validateExtractionMethod } from "./method";
import { validateExtractionVersion } from "./version";

/**
 * Conventional ISO-8601 timestamp prefix: `2026-01-01T00:00:00`. Mirrors the
 * RC4.4 descriptor convention (the pattern is internal there, so direct reuse
 * is impossible); deviations warn, they never block.
 */
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** The fact-side references provenance is checked against, when known. */
export interface ExtractionProvenanceExpectation {
  factId?: ExtractionFactId;
  sourceId?: ProjectSourceId;
  sourceVersion?: ExtractionSourceVersion;
}

/** Validate a provenance chain's source, revision, method, time, and links. */
export function validateExtractionProvenance(
  provenance: ExtractionProvenance,
  expected: ExtractionProvenanceExpectation = {},
  base = "provenance",
): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];

  if (!isNonEmptyString(provenance.sourceId)) {
    issues.push(
      extractionError(
        "missing_provenance_source",
        "Extraction provenance names no catalogued source",
        `${base}.sourceId`,
      ),
    );
  } else if (
    expected.sourceId !== undefined &&
    isNonEmptyString(expected.sourceId) &&
    provenance.sourceId !== expected.sourceId
  ) {
    issues.push(
      extractionError(
        "provenance_source_mismatch",
        `Extraction provenance points at source "${provenance.sourceId}" but the fact claims "${expected.sourceId}"`,
        `${base}.sourceId`,
      ),
    );
  }

  if (isAbsent(provenance.sourceVersion)) {
    issues.push(
      extractionError(
        "missing_provenance_version",
        "Extraction provenance pins no source revision",
        `${base}.sourceVersion`,
      ),
    );
  } else {
    issues.push(
      ...validateExtractionVersion(provenance.sourceVersion).map((issue) => ({
        ...issue,
        path: `${base}.sourceVersion`,
      })),
    );
    // A mismatch is only reportable when the comparison is a real number —
    // malformed parts compare to NaN and are already flagged by the reused
    // version guard, never double-reported as a fabricated mismatch.
    const comparison = isAbsent(expected.sourceVersion)
      ? 0
      : compareExtractionVersion(provenance.sourceVersion, expected.sourceVersion);
    if (Number.isFinite(comparison) && comparison !== 0) {
      issues.push(
        extractionError(
          "provenance_version_mismatch",
          "Extraction provenance pins a different source revision than the fact claims",
          `${base}.sourceVersion`,
        ),
      );
    }
  }

  if (isAbsent(provenance.method)) {
    issues.push(
      extractionError(
        "missing_extraction_method",
        "Extraction provenance describes no extraction method",
        `${base}.method`,
      ),
    );
  } else {
    issues.push(...validateExtractionMethod(provenance.method, `${base}.method`));
  }

  if (!isNonEmptyString(provenance.extractedAt)) {
    issues.push(
      extractionError(
        "missing_extraction_time",
        "Extraction provenance carries no caller-supplied extraction time",
        `${base}.extractedAt`,
      ),
    );
  } else if (!ISO_DATE_TIME_PATTERN.test(provenance.extractedAt)) {
    issues.push(
      extractionWarning(
        "unconventional_extraction_time",
        `Extraction time "${provenance.extractedAt}" is not an ISO-8601 timestamp`,
        `${base}.extractedAt`,
      ),
    );
  }

  if (provenance.recipeId !== undefined && !isNonEmptyString(provenance.recipeId)) {
    issues.push(
      extractionError(
        "empty_provenance_recipe",
        "Extraction provenance declares an empty recipe reference",
        `${base}.recipeId`,
      ),
    );
  }
  if (provenance.stepId !== undefined && !isNonEmptyString(provenance.stepId)) {
    issues.push(
      extractionError(
        "empty_provenance_step",
        "Extraction provenance declares an empty step reference",
        `${base}.stepId`,
      ),
    );
  }

  if (provenance.derivedFrom !== undefined && !Array.isArray(provenance.derivedFrom)) {
    issues.push(
      extractionError(
        "invalid_derived_from",
        "Extraction provenance declares a non-list derivation chain",
        `${base}.derivedFrom`,
      ),
    );
  } else if (provenance.derivedFrom !== undefined) {
    const seen = new Set<string>();
    provenance.derivedFrom.forEach((id, index) => {
      if (!isNonEmptyString(id)) {
        issues.push(
          extractionError(
            "empty_derived_reference",
            "Extraction provenance declares an empty derivation reference",
            `${base}.derivedFrom.${index}`,
          ),
        );
        return;
      }
      if (seen.has(id)) {
        issues.push(
          extractionError(
            "duplicate_derived_reference",
            `Extraction provenance repeats the derivation reference "${id}"`,
            `${base}.derivedFrom.${index}`,
          ),
        );
      }
      seen.add(id);
      if (expected.factId !== undefined && id === expected.factId) {
        issues.push(
          extractionError(
            "self_derived_reference",
            "Extraction provenance derives the fact from itself",
            `${base}.derivedFrom.${index}`,
          ),
        );
      }
    });
  }

  return issues;
}
