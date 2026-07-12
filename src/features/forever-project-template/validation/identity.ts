/**
 * Forever Project Template — identity validation.
 *
 * Structural guards over a {@link ProjectTemplateIdentity} and a
 * {@link ProjectPackageIdentity}: the required fields must be present, a package's
 * `scope` must be a known scope, and a slug that is not already normalized is
 * flagged as a warning (never rewritten — RC4.2 reports, it does not mutate). All
 * checks return issues; none throw.
 */

import { isNonEmptyString } from "../helpers";
import { normalizeProjectSlug } from "../identity";
import type { ProjectPackageIdentity, ProjectTemplateIdentity } from "../identity";
import { isKnownProjectPackageScope, projectTemplateError, projectTemplateWarning } from "../types";
import type { ProjectTemplateIssue } from "../types";

/** Validate a template identity's required fields. */
export function validateProjectTemplateIdentity(
  identity: ProjectTemplateIdentity,
): ProjectTemplateIssue[] {
  const issues: ProjectTemplateIssue[] = [];
  if (!isNonEmptyString(identity.id)) {
    issues.push(
      projectTemplateError("missing_template_id", "Template identity is missing an id", "identity.id"),
    );
  }
  if (!isNonEmptyString(identity.slug)) {
    issues.push(
      projectTemplateError(
        "missing_template_slug",
        "Template identity is missing a slug",
        "identity.slug",
      ),
    );
  }
  if (!isNonEmptyString(identity.name)) {
    issues.push(
      projectTemplateError(
        "missing_template_name",
        "Template identity is missing a name",
        "identity.name",
      ),
    );
  }
  return issues;
}

/** Validate a package identity's required fields, scope, and slug normalization. */
export function validateProjectPackageIdentity(
  identity: ProjectPackageIdentity,
  base = "identity",
): ProjectTemplateIssue[] {
  const issues: ProjectTemplateIssue[] = [];
  if (!isNonEmptyString(identity.id)) {
    issues.push(
      projectTemplateError("missing_package_id", "Package identity is missing an id", `${base}.id`),
    );
  }
  if (!isNonEmptyString(identity.slug)) {
    issues.push(
      projectTemplateError(
        "missing_package_slug",
        "Package identity is missing a slug",
        `${base}.slug`,
      ),
    );
  } else if (identity.slug !== normalizeProjectSlug(identity.slug)) {
    issues.push(
      projectTemplateWarning(
        "unnormalized_package_slug",
        `Package slug "${identity.slug}" is not normalized to the RC3.0 slug rule`,
        `${base}.slug`,
      ),
    );
  }
  if (!isNonEmptyString(identity.name)) {
    issues.push(
      projectTemplateError(
        "missing_package_name",
        "Package identity is missing a name",
        `${base}.name`,
      ),
    );
  }
  if (!isKnownProjectPackageScope(identity.scope)) {
    issues.push(
      projectTemplateError(
        "unknown_package_scope",
        `Package identity has an unknown scope "${String(identity.scope)}"`,
        `${base}.scope`,
      ),
    );
  }
  return issues;
}
