/**
 * Forever Extraction Pipeline — method validation.
 *
 * Structural guards over an {@link ExtractionMethodDescriptor}: the kind must
 * be a known vocabulary value, and the optional tool and description — when
 * present — must be non-empty. All checks return issues; none throw.
 */

import { isNonEmptyString } from "../helpers";
import { isKnownExtractionMethodKind } from "../method";
import type { ExtractionMethodDescriptor } from "../method";
import { extractionError } from "../types";
import type { ExtractionIssue } from "../types";

/** Validate a method descriptor's kind and optional designations. */
export function validateExtractionMethod(
  method: ExtractionMethodDescriptor,
  base = "method",
): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];
  if (!isKnownExtractionMethodKind(method.kind)) {
    issues.push(
      extractionError(
        "unknown_method_kind",
        `Extraction method has an unknown kind "${String(method.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  if (method.tool !== undefined && !isNonEmptyString(method.tool)) {
    issues.push(
      extractionError(
        "empty_method_tool",
        "Extraction method designates an empty tool",
        `${base}.tool`,
      ),
    );
  }
  if (method.description !== undefined && !isNonEmptyString(method.description)) {
    issues.push(
      extractionError(
        "empty_method_description",
        "Extraction method declares an empty description",
        `${base}.description`,
      ),
    );
  }
  return issues;
}
