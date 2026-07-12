/**
 * Forever Canonical Project Database — snapshot validation.
 *
 * Structural guards over one {@link ProjectSnapshot} and over a record's
 * whole snapshot history: identity and revision references present, a
 * positive integer frozen revision number, well-formed frozen fields with no
 * duplicated path, and — across a history — unique snapshot ids and at most
 * one snapshot per revision (a duplicate snapshot is flagged, never silently
 * replaced, because snapshot history is append-only data). A structurally
 * absent part is reported as missing, never dereferenced. All checks return
 * issues; none throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import type { ProjectSnapshot } from "../snapshot";
import { projectDatabaseError } from "../types";
import type { ProjectDatabaseIssue } from "../types";
import { validateProjectField } from "./field";
import { projectTimestampIssues } from "./value";

function at(base: string, path: string): string {
  return base === "" ? path : `${base}.${path}`;
}

/** Validate a whole snapshot. `base` locates it, e.g. `snapshots.0`. */
export function validateProjectSnapshot(
  snapshot: ProjectSnapshot,
  base = "",
): ProjectDatabaseIssue[] {
  if (isAbsent(snapshot)) {
    return [
      projectDatabaseError(
        "missing_snapshot",
        "Snapshot is absent",
        base === "" ? "snapshot" : base,
      ),
    ];
  }
  const issues: ProjectDatabaseIssue[] = [];

  if (!isNonEmptyString(snapshot.id)) {
    issues.push(
      projectDatabaseError("missing_snapshot_id", "Snapshot is missing an id", at(base, "id")),
    );
  }
  if (!isNonEmptyString(snapshot.projectId)) {
    issues.push(
      projectDatabaseError(
        "missing_snapshot_project",
        "Snapshot names no canonical project",
        at(base, "projectId"),
      ),
    );
  }
  if (!isNonEmptyString(snapshot.revisionId)) {
    issues.push(
      projectDatabaseError(
        "missing_snapshot_revision",
        "Snapshot pins no revision",
        at(base, "revisionId"),
      ),
    );
  }
  if (!Number.isInteger(snapshot.revisionNumber) || snapshot.revisionNumber < 1) {
    issues.push(
      projectDatabaseError(
        "invalid_snapshot_revision_number",
        `Snapshot revision number "${String(snapshot.revisionNumber)}" is not a positive integer`,
        at(base, "revisionNumber"),
      ),
    );
  }
  if (snapshot.takenAt !== undefined) {
    issues.push(
      ...projectTimestampIssues(
        snapshot.takenAt,
        "taken_time",
        "Snapshot declares an empty taken time",
        at(base, "takenAt"),
      ),
    );
  }

  if (!Array.isArray(snapshot.fields)) {
    issues.push(
      projectDatabaseError(
        "invalid_snapshot_fields",
        "Snapshot fields must be a list",
        at(base, "fields"),
      ),
    );
  } else {
    const seenPaths = new Set<string>();
    snapshot.fields.forEach((field, index) => {
      issues.push(...validateProjectField(field, at(base, `fields.${index}`)));
      const path = field?.path;
      if (isNonEmptyString(path)) {
        if (seenPaths.has(path)) {
          issues.push(
            projectDatabaseError(
              "duplicate_field_path",
              `Snapshot freezes the path "${path}" more than once`,
              at(base, `fields.${index}.path`),
            ),
          );
        }
        seenPaths.add(path);
      }
    });
  }

  return issues;
}

/**
 * Validate a record's whole snapshot history: every snapshot individually,
 * unique snapshot ids, and at most one snapshot per revision — a duplicate is
 * flagged, never silently replaced.
 */
export function validateProjectSnapshots(
  snapshots: readonly ProjectSnapshot[],
  base = "snapshots",
): ProjectDatabaseIssue[] {
  if (!Array.isArray(snapshots)) {
    return [projectDatabaseError("invalid_snapshots", "Snapshot history must be a list", base)];
  }
  const issues: ProjectDatabaseIssue[] = [];
  const seenIds = new Set<string>();
  const seenRevisions = new Set<string>();

  snapshots.forEach((snapshot, index) => {
    issues.push(...validateProjectSnapshot(snapshot, `${base}.${index}`));
    if (isAbsent(snapshot)) return;

    if (isNonEmptyString(snapshot.id)) {
      if (seenIds.has(snapshot.id)) {
        issues.push(
          projectDatabaseError(
            "duplicate_snapshot",
            `Snapshot id "${snapshot.id}" appears more than once`,
            `${base}.${index}.id`,
          ),
        );
      }
      seenIds.add(snapshot.id);
    }
    if (isNonEmptyString(snapshot.revisionId)) {
      if (seenRevisions.has(snapshot.revisionId)) {
        issues.push(
          projectDatabaseError(
            "duplicate_snapshot_revision",
            `Revision "${snapshot.revisionId}" is snapshotted more than once`,
            `${base}.${index}.revisionId`,
          ),
        );
      }
      seenRevisions.add(snapshot.revisionId);
    }
  });

  return issues;
}
