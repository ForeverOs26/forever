/**
 * Forever Project Template — bundle validation.
 *
 * Validates an assembled {@link ProjectBundle}: the template and the package are
 * each validated in full, the package must name the very template it is bundled
 * with (else it was measured against the wrong one), it must provide every
 * component the template requires, any component it provides that the template
 * does not define is flagged, and every required reference must have both its
 * endpoints among the provided components (else the reference could never
 * resolve). All checks return issues; none throw.
 *
 * This is the check that enforces RC4.2's promise — "provide verified source
 * data, follow the template for everything else" — because a bundle is invalid
 * exactly when a required part of the template is not provided.
 */

import type { ProjectBundle } from "../bundle";
import { missingProjectComponentKinds } from "../bundle";
import { summarizeProjectConformance } from "../helpers";
import { requiredProjectReferences } from "../reference";
import { projectTemplateError, projectTemplateWarning } from "../types";
import type { ProjectTemplateIssue } from "../types";
import { validateProjectPackage } from "./package";
import { validateProjectTemplate } from "./template";

/** Validate an assembled bundle, composing the template and package guards. */
export function validateProjectBundle(bundle: ProjectBundle): ProjectTemplateIssue[] {
  const issues: ProjectTemplateIssue[] = [];
  issues.push(...validateProjectTemplate(bundle.template));
  issues.push(...validateProjectPackage(bundle.package));

  if (bundle.package.templateId !== bundle.template.identity.id) {
    issues.push(
      projectTemplateWarning(
        "bundle_template_mismatch",
        `Package conforms to template "${bundle.package.templateId}" but is bundled with "${bundle.template.identity.id}"`,
        "package.templateId",
      ),
    );
  }

  for (const kind of missingProjectComponentKinds(bundle)) {
    issues.push(
      projectTemplateError(
        "missing_required_component",
        `Package does not provide required component "${kind}"`,
        "package.provides",
      ),
    );
  }

  const { extra } = summarizeProjectConformance(bundle.template, bundle.package);
  for (const kind of extra) {
    issues.push(
      projectTemplateWarning(
        "extra_provided_component",
        `Package provides component "${kind}" the template does not define`,
        "package.provides",
      ),
    );
  }

  const provided = new Set(bundle.package.provides);
  for (const reference of requiredProjectReferences(bundle.references)) {
    for (const endpoint of [reference.from, reference.to]) {
      if (!provided.has(endpoint)) {
        issues.push(
          projectTemplateWarning(
            "unsatisfiable_reference",
            `Required reference "${reference.kind}" names component "${endpoint}" the package does not provide`,
            "references",
          ),
        );
      }
    }
  }

  return issues;
}
