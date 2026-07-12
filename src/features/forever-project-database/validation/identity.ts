/**
 * Forever Canonical Project Database — identity validation.
 *
 * Structural guards over a {@link ProjectRecordIdentity}: the required fields
 * must be present, a slug that is not already normalized is flagged as a
 * warning (never rewritten — RC4.6 reports, it does not mutate), and a
 * project id that does not follow the reused RC4.2 `proj_` derivation for the
 * slug is flagged so a record can never quietly point at a different project
 * than its slug names. All checks return issues; none throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import { normalizeProjectDatabaseSlug, projectDatabaseProjectId } from "../identity";
import type { ProjectRecordIdentity } from "../identity";
import { projectDatabaseError, projectDatabaseWarning } from "../types";
import type { ProjectDatabaseIssue } from "../types";

/** Validate a record identity's required fields, slug, and project id. */
export function validateProjectRecordIdentity(
  identity: ProjectRecordIdentity,
  base = "identity",
): ProjectDatabaseIssue[] {
  if (isAbsent(identity)) {
    return [projectDatabaseError("missing_record_identity", "Record identity is absent", base)];
  }
  const issues: ProjectDatabaseIssue[] = [];
  if (!isNonEmptyString(identity.id)) {
    issues.push(
      projectDatabaseError("missing_record_id", "Record identity is missing an id", `${base}.id`),
    );
  }
  if (!isNonEmptyString(identity.slug)) {
    issues.push(
      projectDatabaseError(
        "missing_record_slug",
        "Record identity is missing a slug",
        `${base}.slug`,
      ),
    );
  } else if (identity.slug !== normalizeProjectDatabaseSlug(identity.slug)) {
    issues.push(
      projectDatabaseWarning(
        "unnormalized_record_slug",
        `Record slug "${identity.slug}" is not normalized to the RC3.0 slug rule`,
        `${base}.slug`,
      ),
    );
  }
  if (!isNonEmptyString(identity.name)) {
    issues.push(
      projectDatabaseError(
        "missing_record_name",
        "Record identity is missing a name",
        `${base}.name`,
      ),
    );
  }
  if (!isNonEmptyString(identity.projectId)) {
    issues.push(
      projectDatabaseError(
        "missing_record_project",
        "Record identity names no canonical project",
        `${base}.projectId`,
      ),
    );
  } else if (
    isNonEmptyString(identity.slug) &&
    identity.projectId !== projectDatabaseProjectId(identity.slug)
  ) {
    issues.push(
      projectDatabaseError(
        "record_project_mismatch",
        `Record identity points at "${identity.projectId}" but its slug derives "${projectDatabaseProjectId(identity.slug)}"`,
        `${base}.projectId`,
      ),
    );
  }
  return issues;
}
