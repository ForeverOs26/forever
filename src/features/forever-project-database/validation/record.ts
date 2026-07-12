/**
 * Forever Canonical Project Database — record validation.
 *
 * Composes the identity, version, field, revision, snapshot, and timeline
 * guards and adds the checks that span one whole {@link ProjectRecord}: no
 * two fields may share an id or a canonical path (conflicting statements the
 * record cannot hold), every field, revision, snapshot, and timeline must
 * belong to the record's own project, every snapshot must pin a revision the
 * record actually holds — with the matching sequence number — and a value
 * that names a revision the record does not (yet) hold is flagged as a
 * warning, because a described-but-unapplied merge legitimately references
 * the revision it would introduce. Cross-record integrity (every project
 * exactly one canonical record) lives one level up, in
 * {@link import("./database").validateProjectDatabase}. A structurally
 * absent part is reported as missing, never dereferenced. All checks return
 * issues; none throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import type { ProjectRecord } from "../record";
import { isKnownProjectRecordStatus } from "../status";
import { projectDatabaseError, projectDatabaseWarning } from "../types";
import type { ProjectDatabaseIssue } from "../types";
import { validateProjectField } from "./field";
import { validateProjectRecordIdentity } from "./identity";
import { validateProjectRevisions } from "./revision";
import { validateProjectSnapshots } from "./snapshot";
import { validateProjectTimeline } from "./timeline";
import { validateProjectRecordVersion } from "./version";

function at(base: string, path: string): string {
  return base === "" ? path : `${base}.${path}`;
}

/** Validate a whole record. `base` locates it, e.g. `records.0`; empty when standalone. */
export function validateProjectRecord(record: ProjectRecord, base = ""): ProjectDatabaseIssue[] {
  if (isAbsent(record)) {
    return [
      projectDatabaseError(
        "missing_record",
        "Canonical record is absent",
        base === "" ? "record" : base,
      ),
    ];
  }
  const issues: ProjectDatabaseIssue[] = [];

  if (isAbsent(record.identity)) {
    issues.push(
      projectDatabaseError(
        "missing_record_identity",
        "Record carries no identity",
        at(base, "identity"),
      ),
    );
  } else {
    issues.push(...validateProjectRecordIdentity(record.identity, at(base, "identity")));
  }
  const projectId = record.identity?.projectId;

  if (isAbsent(record.version)) {
    issues.push(
      projectDatabaseError(
        "missing_record_version",
        "Record pins no canonical shape version",
        at(base, "version"),
      ),
    );
  } else {
    issues.push(
      ...validateProjectRecordVersion(record.version).map((issue) => ({
        ...issue,
        path: at(base, "version"),
      })),
    );
  }

  if (!isKnownProjectRecordStatus(record.status)) {
    issues.push(
      projectDatabaseError(
        "unknown_record_status",
        `Record has an unknown status "${String(record.status)}"`,
        at(base, "status"),
      ),
    );
  }

  // Fields: each coherent on its own, no duplicated id or path, and every
  // field belonging to the record's own project.
  const revisionIds = new Set<string>();
  const revisionNumbers = new Map<string, number>();
  if (Array.isArray(record.revisions)) {
    for (const revision of record.revisions) {
      if (!isAbsent(revision) && isNonEmptyString(revision.id)) {
        revisionIds.add(revision.id);
        if (Number.isInteger(revision.number)) {
          revisionNumbers.set(revision.id, revision.number);
        }
      }
    }
  }

  if (!Array.isArray(record.fields)) {
    issues.push(
      projectDatabaseError("invalid_fields", "Record fields must be a list", at(base, "fields")),
    );
  } else {
    const seenIds = new Set<string>();
    const seenPaths = new Set<string>();
    record.fields.forEach((field, index) => {
      const fieldBase = at(base, `fields.${index}`);
      issues.push(...validateProjectField(field, fieldBase));
      if (isAbsent(field)) return;

      if (isNonEmptyString(field.id)) {
        if (seenIds.has(field.id)) {
          issues.push(
            projectDatabaseError(
              "duplicate_field_id",
              `Field id "${field.id}" appears more than once`,
              `${fieldBase}.id`,
            ),
          );
        }
        seenIds.add(field.id);
      }
      if (isNonEmptyString(field.path)) {
        if (seenPaths.has(field.path)) {
          issues.push(
            projectDatabaseError(
              "duplicate_field_path",
              `Canonical path "${field.path}" is described by more than one field`,
              `${fieldBase}.path`,
            ),
          );
        }
        seenPaths.add(field.path);
      }
      if (
        isNonEmptyString(field.projectId) &&
        isNonEmptyString(projectId) &&
        field.projectId !== projectId
      ) {
        issues.push(
          projectDatabaseError(
            "field_project_mismatch",
            `Field belongs to "${field.projectId}", not "${projectId}"`,
            `${fieldBase}.projectId`,
          ),
        );
      }
      // A value may name the revision that introduced it; naming one the
      // record does not hold is flagged as a warning — a described-but-
      // unapplied merge legitimately references the revision it would
      // introduce.
      if (Array.isArray(field.values)) {
        field.values.forEach((value, valueIndex) => {
          if (
            !isAbsent(value) &&
            isNonEmptyString(value.revisionId) &&
            !revisionIds.has(value.revisionId)
          ) {
            issues.push(
              projectDatabaseWarning(
                "unknown_revision_reference",
                `Value names revision "${value.revisionId}", which the record does not hold`,
                `${fieldBase}.values.${valueIndex}.revisionId`,
              ),
            );
          }
        });
      }
    });
  }

  // Revisions: individually coherent, unique, strictly increasing, chained.
  issues.push(...validateProjectRevisions(record.revisions, at(base, "revisions")));
  if (Array.isArray(record.revisions)) {
    record.revisions.forEach((revision, index) => {
      if (
        !isAbsent(revision) &&
        isNonEmptyString(revision.projectId) &&
        isNonEmptyString(projectId) &&
        revision.projectId !== projectId
      ) {
        issues.push(
          projectDatabaseError(
            "revision_project_mismatch",
            `Revision belongs to "${revision.projectId}", not "${projectId}"`,
            at(base, `revisions.${index}.projectId`),
          ),
        );
      }
    });
  }

  // Snapshots: individually coherent, unique per revision, and pinning a
  // revision the record actually holds, with the matching sequence number.
  issues.push(...validateProjectSnapshots(record.snapshots, at(base, "snapshots")));
  if (Array.isArray(record.snapshots)) {
    record.snapshots.forEach((snapshot, index) => {
      if (isAbsent(snapshot)) return;
      const snapshotBase = at(base, `snapshots.${index}`);
      if (
        isNonEmptyString(snapshot.projectId) &&
        isNonEmptyString(projectId) &&
        snapshot.projectId !== projectId
      ) {
        issues.push(
          projectDatabaseError(
            "snapshot_project_mismatch",
            `Snapshot belongs to "${snapshot.projectId}", not "${projectId}"`,
            `${snapshotBase}.projectId`,
          ),
        );
      }
      if (isNonEmptyString(snapshot.revisionId)) {
        if (!revisionIds.has(snapshot.revisionId)) {
          issues.push(
            projectDatabaseError(
              "unknown_revision_reference",
              `Snapshot pins revision "${snapshot.revisionId}", which the record does not hold`,
              `${snapshotBase}.revisionId`,
            ),
          );
        } else if (
          revisionNumbers.has(snapshot.revisionId) &&
          Number.isInteger(snapshot.revisionNumber) &&
          revisionNumbers.get(snapshot.revisionId) !== snapshot.revisionNumber
        ) {
          issues.push(
            projectDatabaseError(
              "snapshot_revision_mismatch",
              `Snapshot claims revision number ${String(snapshot.revisionNumber)} but revision "${snapshot.revisionId}" is number ${String(revisionNumbers.get(snapshot.revisionId))}`,
              `${snapshotBase}.revisionNumber`,
            ),
          );
        }
      }
    });
  }

  // Timeline: coherent on its own and belonging to the record's own project.
  if (isAbsent(record.timeline)) {
    issues.push(
      projectDatabaseError("missing_timeline", "Record carries no timeline", at(base, "timeline")),
    );
  } else {
    issues.push(...validateProjectTimeline(record.timeline, at(base, "timeline")));
    if (
      isNonEmptyString(record.timeline.projectId) &&
      isNonEmptyString(projectId) &&
      record.timeline.projectId !== projectId
    ) {
      issues.push(
        projectDatabaseError(
          "timeline_project_mismatch",
          `Timeline belongs to "${record.timeline.projectId}", not "${projectId}"`,
          at(base, "timeline.projectId"),
        ),
      );
    }
  }

  if (record.sourceIds !== undefined && !Array.isArray(record.sourceIds)) {
    issues.push(
      projectDatabaseError(
        "invalid_source_refs",
        "Record declares a non-list sourceIds value",
        at(base, "sourceIds"),
      ),
    );
  } else if (record.sourceIds !== undefined) {
    const seen = new Set<string>();
    record.sourceIds.forEach((id, index) => {
      if (!isNonEmptyString(id)) {
        issues.push(
          projectDatabaseError(
            "empty_source_reference",
            "Record declares an empty source reference",
            at(base, `sourceIds.${index}`),
          ),
        );
        return;
      }
      if (seen.has(id)) {
        issues.push(
          projectDatabaseError(
            "duplicate_source_reference",
            `Record repeats the source reference "${id}"`,
            at(base, `sourceIds.${index}`),
          ),
        );
      }
      seen.add(id);
    });
  }

  if (record.issues !== undefined && !Array.isArray(record.issues)) {
    issues.push(
      projectDatabaseError(
        "invalid_record_issues",
        "Record declares a non-list issues value",
        at(base, "issues"),
      ),
    );
  }

  return issues;
}
