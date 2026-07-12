/**
 * Forever Project Sources — identity validation.
 *
 * Structural guards over a {@link ProjectSourceIdentity}: the required fields
 * must be present, and a slug that is not already normalized is flagged as a
 * warning (never rewritten — RC4.4 reports, it does not mutate). All checks
 * return issues; none throw.
 */

import { isNonEmptyString } from "../helpers";
import { normalizeProjectSourceSlug } from "../identity";
import type { ProjectSourceIdentity } from "../identity";
import { projectSourceError, projectSourceWarning } from "../types";
import type { ProjectSourceIssue } from "../types";

/** Validate a source identity's required fields and slug normalization. */
export function validateProjectSourceIdentity(
  identity: ProjectSourceIdentity,
  base = "identity",
): ProjectSourceIssue[] {
  const issues: ProjectSourceIssue[] = [];
  if (!isNonEmptyString(identity.id)) {
    issues.push(
      projectSourceError("missing_source_id", "Source identity is missing an id", `${base}.id`),
    );
  }
  if (!isNonEmptyString(identity.slug)) {
    issues.push(
      projectSourceError(
        "missing_source_slug",
        "Source identity is missing a slug",
        `${base}.slug`,
      ),
    );
  } else if (identity.slug !== normalizeProjectSourceSlug(identity.slug)) {
    issues.push(
      projectSourceWarning(
        "unnormalized_source_slug",
        `Source slug "${identity.slug}" is not normalized to the RC3.0 slug rule`,
        `${base}.slug`,
      ),
    );
  }
  if (!isNonEmptyString(identity.name)) {
    issues.push(
      projectSourceError(
        "missing_source_name",
        "Source identity is missing a name",
        `${base}.name`,
      ),
    );
  }
  if (!isNonEmptyString(identity.projectId)) {
    issues.push(
      projectSourceError(
        "missing_project_id",
        "Source identity is missing a project id",
        `${base}.projectId`,
      ),
    );
  }
  return issues;
}
