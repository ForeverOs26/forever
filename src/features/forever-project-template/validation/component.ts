/**
 * Forever Project Template — component validation.
 *
 * Structural guards over a {@link ProjectComponent}: name must be present, `kind`
 * and `foundation` must be known vocabulary values, and `required` must be a
 * boolean. All checks return issues; none throw.
 */

import {
  isKnownProjectComponentKind,
  isKnownProjectFoundation,
  type ProjectComponent,
} from "../component";
import { isNonEmptyString } from "../helpers";
import { projectTemplateError } from "../types";
import type { ProjectTemplateIssue } from "../types";

/** Validate one component descriptor. */
export function validateProjectComponent(
  component: ProjectComponent,
  index: number,
): ProjectTemplateIssue[] {
  const issues: ProjectTemplateIssue[] = [];
  const base = `components.${index}`;

  if (!isKnownProjectComponentKind(component.kind)) {
    issues.push(
      projectTemplateError(
        "unknown_component_kind",
        `Component has an unknown kind "${String(component.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  if (!isNonEmptyString(component.name)) {
    issues.push(
      projectTemplateError("missing_component_name", "Component is missing a name", `${base}.name`),
    );
  }
  if (!isKnownProjectFoundation(component.foundation)) {
    issues.push(
      projectTemplateError(
        "unknown_component_foundation",
        `Component "${String(component.kind)}" names an unknown foundation "${String(component.foundation)}"`,
        `${base}.foundation`,
      ),
    );
  }
  if (typeof component.required !== "boolean") {
    issues.push(
      projectTemplateError(
        "invalid_component_required",
        `Component "${String(component.kind)}" has a non-boolean required flag`,
        `${base}.required`,
      ),
    );
  }
  return issues;
}
