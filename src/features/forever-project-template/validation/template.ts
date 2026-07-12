/**
 * Forever Project Template — template validation.
 *
 * Composes the identity, component, layout, and reference guards and adds the
 * checks that span a whole {@link ProjectTemplate}: it must declare at least one
 * component, component kinds must be unique, at least one component must be
 * required, every component a node in the layout places must be a component the
 * template declares (a warning — the layout would host an undeclared component),
 * and every component a reference names must likewise be declared (a warning).
 * All checks return issues; none throw.
 */

import { projectLayoutComponents } from "../layout";
import { projectReferencedComponents } from "../helpers";
import type { ProjectTemplate } from "../template";
import { projectTemplateError, projectTemplateWarning } from "../types";
import type { ProjectTemplateIssue } from "../types";
import { validateProjectComponent } from "./component";
import { validateProjectTemplateIdentity } from "./identity";
import { validateProjectLayout } from "./layout";
import { validateProjectReference } from "./reference";

/** Validate a whole template, composing every sub-guard. */
export function validateProjectTemplate(template: ProjectTemplate): ProjectTemplateIssue[] {
  const issues: ProjectTemplateIssue[] = [];
  issues.push(...validateProjectTemplateIdentity(template.identity));

  const components = Array.isArray(template.components) ? template.components : [];
  const references = Array.isArray(template.references) ? template.references : [];

  if (components.length === 0) {
    issues.push(
      projectTemplateError(
        "no_components",
        "Template must declare at least one component",
        "components",
      ),
    );
  }

  const seenKinds = new Set<string>();
  const declared = new Set<string>();
  components.forEach((component, index) => {
    issues.push(...validateProjectComponent(component, index));
    if (seenKinds.has(component.kind)) {
      issues.push(
        projectTemplateError(
          "duplicate_component_kind",
          `Component kind "${component.kind}" is declared more than once`,
          `components.${index}.kind`,
        ),
      );
    }
    seenKinds.add(component.kind);
    declared.add(component.kind);
  });

  if (components.length > 0 && !components.some((c) => c.required === true)) {
    issues.push(
      projectTemplateWarning(
        "no_required_component",
        "Template declares no required component",
        "components",
      ),
    );
  }

  issues.push(...validateProjectLayout(template.layout));

  // Every component the layout places must be a component the template declares.
  for (const kind of projectLayoutComponents(template.layout)) {
    if (!declared.has(kind)) {
      issues.push(
        projectTemplateWarning(
          "layout_component_undeclared",
          `Layout places component "${kind}" not declared by the template`,
          "layout",
        ),
      );
    }
  }

  references.forEach((reference, index) => {
    issues.push(...validateProjectReference(reference, index));
  });

  // Every component a reference names must be a component the template declares.
  for (const kind of projectReferencedComponents(references)) {
    if (!declared.has(kind)) {
      issues.push(
        projectTemplateWarning(
          "reference_component_undeclared",
          `Reference names component "${kind}" not declared by the template`,
          "references",
        ),
      );
    }
  }

  return issues;
}
