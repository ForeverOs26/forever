/**
 * Forever Canonical Project Database — field validation.
 *
 * Composes the value guard over a field's whole history and adds the checks
 * that span one {@link ProjectField}: the identity references must be
 * present, the canonical path must be a well-formed dotted locator, the
 * section must be a known vocabulary value that agrees with what the path
 * itself declares, the history must be a list holding at most one standing
 * `current` entry (two standing values is a conflict the field cannot hold —
 * flagged, never resolved), and the validation standing must be a known
 * vocabulary value. A structurally absent part is reported as missing, never
 * dereferenced. All checks return issues; none throw.
 */

import type { ProjectField } from "../field";
import { isAbsent, isNonEmptyString } from "../helpers";
import { isKnownProjectSectionKey, projectSectionForPath } from "../section";
import { isKnownProjectFieldValidationStatus } from "../status";
import { projectDatabaseError, projectDatabaseWarning } from "../types";
import type { ProjectDatabaseIssue } from "../types";
import { validateProjectFieldValue } from "./value";

/** Well-formed dotted canonical path: `pricing.basePrice`, `general.name`. */
const FIELD_PATH_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

function at(base: string, path: string): string {
  return base === "" ? path : `${base}.${path}`;
}

/** Validate a whole field. `base` locates it, e.g. `fields.0`; empty when standalone. */
export function validateProjectField(field: ProjectField, base = ""): ProjectDatabaseIssue[] {
  if (isAbsent(field)) {
    return [
      projectDatabaseError(
        "missing_field",
        "Canonical field is absent",
        base === "" ? "field" : base,
      ),
    ];
  }
  const issues: ProjectDatabaseIssue[] = [];

  if (!isNonEmptyString(field.id)) {
    issues.push(projectDatabaseError("missing_field_id", "Field is missing an id", at(base, "id")));
  }
  if (!isNonEmptyString(field.projectId)) {
    issues.push(
      projectDatabaseError(
        "missing_field_project",
        "Field names no canonical project",
        at(base, "projectId"),
      ),
    );
  }

  if (!isNonEmptyString(field.path)) {
    issues.push(
      projectDatabaseError(
        "missing_field_path",
        "Field declares no canonical path",
        at(base, "path"),
      ),
    );
  } else if (!FIELD_PATH_PATTERN.test(field.path)) {
    issues.push(
      projectDatabaseError(
        "invalid_field_path",
        `Field path "${field.path}" is not a well-formed dotted locator`,
        at(base, "path"),
      ),
    );
  }

  if (!isNonEmptyString(field.name)) {
    issues.push(
      projectDatabaseError("missing_field_name", "Field is missing a name", at(base, "name")),
    );
  }

  if (!isKnownProjectSectionKey(field.section)) {
    issues.push(
      projectDatabaseError(
        "unknown_section",
        `Field has an unknown canonical section "${String(field.section)}"`,
        at(base, "section"),
      ),
    );
  } else if (
    isNonEmptyString(field.path) &&
    projectSectionForPath(field.path) !== "unknown" &&
    projectSectionForPath(field.path) !== field.section
  ) {
    issues.push(
      projectDatabaseWarning(
        "section_path_mismatch",
        `Field path "${field.path}" declares section "${projectSectionForPath(field.path)}" but the field is organized under "${field.section}"`,
        at(base, "section"),
      ),
    );
  }

  if (!Array.isArray(field.values)) {
    issues.push(
      projectDatabaseError(
        "invalid_values",
        "Field value history must be a list",
        at(base, "values"),
      ),
    );
  } else {
    field.values.forEach((value, index) => {
      issues.push(...validateProjectFieldValue(value, at(base, `values.${index}`)));
    });
    // At most one entry may stand current: two standing values is a conflict
    // the canonical field cannot hold — flagged, never resolved here.
    const current = field.values.filter((value) => !isAbsent(value) && value.status === "current");
    if (current.length > 1) {
      issues.push(
        projectDatabaseError(
          "conflicting_current_values",
          `Field holds ${current.length} standing current values — a canonical field holds at most one`,
          at(base, "values"),
        ),
      );
    }
  }

  if (!isKnownProjectFieldValidationStatus(field.validationStatus)) {
    issues.push(
      projectDatabaseError(
        "unknown_validation_status",
        `Field has an unknown validation status "${String(field.validationStatus)}"`,
        at(base, "validationStatus"),
      ),
    );
  }

  if (field.issues !== undefined && !Array.isArray(field.issues)) {
    issues.push(
      projectDatabaseError(
        "invalid_field_issues",
        "Field declares a non-list issues value",
        at(base, "issues"),
      ),
    );
  }

  return issues;
}
