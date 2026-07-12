/**
 * Forever Project Template — package validation.
 *
 * Composes the package-identity guard and adds the checks that span a whole
 * {@link ProjectPackage}: it must name a template, declare at least one provided
 * component without repeating one, cover at least one canonical entity without
 * repeating one, and every provided component kind must be a known kind. When a
 * package ships a layout override it is validated too. All checks return issues;
 * none throw.
 *
 * A package is validated *standalone* here — conformance to a specific template
 * (does it provide every required component?) is a bundle concern, checked in
 * {@link import("./bundle").validateProjectBundle}.
 */

import { isKnownProjectComponentKind } from "../component";
import { isNonEmptyString } from "../helpers";
import type { ProjectPackage } from "../package";
import { projectTemplateError } from "../types";
import type { ProjectTemplateIssue } from "../types";
import { validateProjectPackageIdentity } from "./identity";
import { validateProjectLayout } from "./layout";

const ENTITY_KINDS = new Set(["project", "developer", "document", "media"]);

/** Validate a whole package descriptor. */
export function validateProjectPackage(pkg: ProjectPackage): ProjectTemplateIssue[] {
  const issues: ProjectTemplateIssue[] = [];
  issues.push(...validateProjectPackageIdentity(pkg.identity));

  if (!isNonEmptyString(pkg.templateId)) {
    issues.push(
      projectTemplateError(
        "missing_package_template",
        "Package does not name a template it conforms to",
        "templateId",
      ),
    );
  }

  if (!Array.isArray(pkg.provides) || pkg.provides.length === 0) {
    issues.push(
      projectTemplateError(
        "no_provided_components",
        "Package must provide at least one component",
        "provides",
      ),
    );
  }
  const seenComponents = new Set<string>();
  (Array.isArray(pkg.provides) ? pkg.provides : []).forEach((kind, index) => {
    if (!isKnownProjectComponentKind(kind)) {
      issues.push(
        projectTemplateError(
          "unknown_provided_component",
          `Package provides an unknown component "${String(kind)}"`,
          `provides.${index}`,
        ),
      );
    }
    if (seenComponents.has(kind)) {
      issues.push(
        projectTemplateError(
          "duplicate_provided_component",
          `Package provides component "${String(kind)}" more than once`,
          `provides.${index}`,
        ),
      );
    }
    seenComponents.add(kind);
  });

  if (!Array.isArray(pkg.entities) || pkg.entities.length === 0) {
    issues.push(
      projectTemplateError(
        "no_covered_entities",
        "Package must cover at least one canonical entity kind",
        "entities",
      ),
    );
  }
  const seenEntities = new Set<string>();
  (Array.isArray(pkg.entities) ? pkg.entities : []).forEach((kind, index) => {
    if (!ENTITY_KINDS.has(kind)) {
      issues.push(
        projectTemplateError(
          "unknown_covered_entity",
          `Package covers an unknown entity kind "${String(kind)}"`,
          `entities.${index}`,
        ),
      );
    }
    if (seenEntities.has(kind)) {
      issues.push(
        projectTemplateError(
          "duplicate_covered_entity",
          `Package covers entity kind "${String(kind)}" more than once`,
          `entities.${index}`,
        ),
      );
    }
    seenEntities.add(kind);
  });

  if (pkg.layout !== undefined) {
    issues.push(...validateProjectLayout(pkg.layout));
  }

  return issues;
}
