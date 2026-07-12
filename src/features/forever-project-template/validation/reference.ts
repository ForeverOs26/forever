/**
 * Forever Project Template — reference validation.
 *
 * Structural guards over the {@link ProjectReference} contract: every reference's
 * `kind` must be a known reference kind, its `from`/`to` must be known component
 * kinds, and `required` must be a boolean. A reference set may repeat a kind (a
 * pipeline and an integration can both reference sources), so duplicates are not
 * flagged. All checks return issues; none throw.
 */

import { isKnownProjectComponentKind } from "../component";
import { isKnownProjectReferenceKind, type ProjectReference } from "../reference";
import { projectTemplateError } from "../types";
import type { ProjectTemplateIssue } from "../types";

/** Validate one declared reference. */
export function validateProjectReference(
  reference: ProjectReference,
  index: number,
): ProjectTemplateIssue[] {
  const issues: ProjectTemplateIssue[] = [];
  const base = `references.${index}`;

  if (!isKnownProjectReferenceKind(reference.kind)) {
    issues.push(
      projectTemplateError(
        "unknown_reference_kind",
        `Reference has an unknown kind "${String(reference.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  if (!isKnownProjectComponentKind(reference.from)) {
    issues.push(
      projectTemplateError(
        "unknown_reference_from",
        `Reference "${String(reference.kind)}" is made from an unknown component "${String(reference.from)}"`,
        `${base}.from`,
      ),
    );
  }
  if (!isKnownProjectComponentKind(reference.to)) {
    issues.push(
      projectTemplateError(
        "unknown_reference_to",
        `Reference "${String(reference.kind)}" points at an unknown component "${String(reference.to)}"`,
        `${base}.to`,
      ),
    );
  }
  if (typeof reference.required !== "boolean") {
    issues.push(
      projectTemplateError(
        "invalid_reference_required",
        `Reference "${String(reference.kind)}" has a non-boolean required flag`,
        `${base}.required`,
      ),
    );
  }
  return issues;
}
