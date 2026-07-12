/**
 * Forever Extraction Pipeline — step validation.
 *
 * Structural guards over an {@link ExtractionStep}: id and name must be
 * present, `kind` must be a known {@link import("../step").ExtractionStepKind},
 * and every fact type the step narrows to must be a known vocabulary value
 * declared at most once. All checks return issues; none throw.
 */

import { isKnownExtractionFactType } from "../facttype";
import { isNonEmptyString } from "../helpers";
import { isKnownExtractionStepKind, type ExtractionStep } from "../step";
import { extractionError } from "../types";
import type { ExtractionIssue } from "../types";

/** Validate one step of a recipe. `base` locates it, e.g. `stages.0.steps.1`. */
export function validateExtractionStep(step: ExtractionStep, base: string): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];

  if (!isNonEmptyString(step.id)) {
    issues.push(
      extractionError("missing_step_id", "Extraction step is missing an id", `${base}.id`),
    );
  }
  if (!isNonEmptyString(step.name)) {
    issues.push(
      extractionError("missing_step_name", "Extraction step is missing a name", `${base}.name`),
    );
  }
  if (!isKnownExtractionStepKind(step.kind)) {
    issues.push(
      extractionError(
        "unknown_step_kind",
        `Extraction step has an unknown kind "${String(step.kind)}"`,
        `${base}.kind`,
      ),
    );
  }

  const seen = new Set<string>();
  (Array.isArray(step.factTypes) ? step.factTypes : []).forEach((factType, index) => {
    if (!isKnownExtractionFactType(factType)) {
      issues.push(
        extractionError(
          "unsupported_fact_type",
          `Extraction step concerns an unsupported fact type "${String(factType)}"`,
          `${base}.factTypes.${index}`,
        ),
      );
    }
    if (seen.has(factType)) {
      issues.push(
        extractionError(
          "duplicate_step_fact_type",
          `Extraction step concerns fact type "${String(factType)}" more than once`,
          `${base}.factTypes.${index}`,
        ),
      );
    }
    seen.add(factType);
  });

  return issues;
}
