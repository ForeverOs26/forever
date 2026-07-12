/**
 * Forever Extraction Pipeline — confidence validation.
 *
 * Structural guards over an {@link ExtractionConfidence}: the level must be a
 * known vocabulary value, the optional score must be a finite number inside
 * the RC3.0 `0..1` convention, and an `unknown` grade may never carry a score
 * — an unassessed confidence stays unknown, and a number attached to it is a
 * fabricated grade (anti-fabrication). All checks return issues; none throw.
 */

import type { ExtractionConfidence } from "../confidence";
import { isKnownExtractionConfidenceLevel } from "../confidence";
import { extractionError } from "../types";
import type { ExtractionIssue } from "../types";

/** Validate a confidence's level and optional score, and their coherence. */
export function validateExtractionConfidence(
  confidence: ExtractionConfidence,
  base = "confidence",
): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];
  if (!isKnownExtractionConfidenceLevel(confidence.level)) {
    issues.push(
      extractionError(
        "unknown_confidence_level",
        `Extraction confidence has an unknown level "${String(confidence.level)}"`,
        `${base}.level`,
      ),
    );
  }
  if (confidence.score !== undefined) {
    if (
      typeof confidence.score !== "number" ||
      !Number.isFinite(confidence.score) ||
      confidence.score < 0 ||
      confidence.score > 1
    ) {
      issues.push(
        extractionError(
          "invalid_confidence_score",
          `Extraction confidence score "${String(confidence.score)}" is not a finite number in 0..1`,
          `${base}.score`,
        ),
      );
    }
    if (confidence.level === "unknown") {
      issues.push(
        extractionError(
          "score_on_unknown_confidence",
          "Extraction confidence is unknown but carries a score — an unassessed confidence stays unknown",
          `${base}.score`,
        ),
      );
    }
  }
  return issues;
}
