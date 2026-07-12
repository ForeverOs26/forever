/**
 * Forever Canonical Project Database — revision validation.
 *
 * Structural guards over one {@link ProjectRevision} and over a record's
 * whole revision history: identity references present, a positive integer
 * sequence number, a coherent change list (each change's kind known, its
 * path present except on a rejected unmapped reading, and its before/after
 * values coherent with the kind), and — across a history — unique ids,
 * strictly increasing numbers, and an unbroken `basedOn` chain, because
 * revision history is append-only and each revision builds on its
 * predecessor. A structurally absent part is reported as missing, never
 * dereferenced. All checks return issues; none throw.
 */

import { isKnownProjectChangeKind } from "../change";
import type { ProjectChange } from "../change";
import { isAbsent, isNonEmptyString } from "../helpers";
import type { ProjectRevision } from "../revision";
import { projectDatabaseError } from "../types";
import type { ProjectDatabaseIssue } from "../types";
import { projectTimestampIssues, validateProjectFieldValue } from "./value";

function at(base: string, path: string): string {
  return base === "" ? path : `${base}.${path}`;
}

/** Validate one described change. `base` locates it, e.g. `changes.0`. */
export function validateProjectChange(
  change: ProjectChange,
  base = "change",
): ProjectDatabaseIssue[] {
  if (isAbsent(change)) {
    return [projectDatabaseError("missing_change", "Described change is absent", base)];
  }
  const issues: ProjectDatabaseIssue[] = [];

  if (!isKnownProjectChangeKind(change.kind)) {
    issues.push(
      projectDatabaseError(
        "unknown_change_kind",
        `Change has an unknown kind "${String(change.kind)}"`,
        `${base}.kind`,
      ),
    );
  }

  // A rejected unmapped reading legitimately addresses no path; every other
  // change must say which canonical field it moves.
  if (!isNonEmptyString(change.path) && change.kind !== "rejected") {
    issues.push(
      projectDatabaseError(
        "missing_change_path",
        "Change addresses no canonical path",
        `${base}.path`,
      ),
    );
  }

  if (change.fieldId !== undefined && !isNonEmptyString(change.fieldId)) {
    issues.push(
      projectDatabaseError(
        "empty_field_reference",
        "Change declares an empty field reference",
        `${base}.fieldId`,
      ),
    );
  }
  if (change.factId !== undefined && !isNonEmptyString(change.factId)) {
    issues.push(
      projectDatabaseError(
        "empty_fact_reference",
        "Change declares an empty fact reference",
        `${base}.factId`,
      ),
    );
  }
  if (change.note !== undefined && !isNonEmptyString(change.note)) {
    issues.push(
      projectDatabaseError("empty_change_note", "Change declares an empty note", `${base}.note`),
    );
  }

  if (change.before !== undefined) {
    issues.push(...validateProjectFieldValue(change.before, `${base}.before`));
  }
  if (change.after !== undefined) {
    issues.push(...validateProjectFieldValue(change.after, `${base}.after`));
  }

  // Kind coherence: what a change claims to do must match the values it
  // carries — an added value must say what would stand, an update or removal
  // must say what stood.
  if (change.kind === "added" && change.after === undefined) {
    issues.push(
      projectDatabaseError(
        "change_without_after",
        "Added change describes no value that would stand",
        `${base}.after`,
      ),
    );
  }
  if ((change.kind === "updated" || change.kind === "removed") && change.before === undefined) {
    issues.push(
      projectDatabaseError(
        "change_without_before",
        `${change.kind === "updated" ? "Updated" : "Removed"} change describes no value that stood`,
        `${base}.before`,
      ),
    );
  }
  if (change.kind === "updated" && change.after === undefined) {
    issues.push(
      projectDatabaseError(
        "change_without_after",
        "Updated change describes no value that would stand",
        `${base}.after`,
      ),
    );
  }

  return issues;
}

/** Validate a whole revision. `base` locates it, e.g. `revisions.0`. */
export function validateProjectRevision(
  revision: ProjectRevision,
  base = "",
): ProjectDatabaseIssue[] {
  if (isAbsent(revision)) {
    return [
      projectDatabaseError(
        "missing_revision",
        "Revision is absent",
        base === "" ? "revision" : base,
      ),
    ];
  }
  const issues: ProjectDatabaseIssue[] = [];

  if (!isNonEmptyString(revision.id)) {
    issues.push(
      projectDatabaseError("missing_revision_id", "Revision is missing an id", at(base, "id")),
    );
  }
  if (!isNonEmptyString(revision.projectId)) {
    issues.push(
      projectDatabaseError(
        "missing_revision_project",
        "Revision names no canonical project",
        at(base, "projectId"),
      ),
    );
  }
  if (!Number.isInteger(revision.number) || revision.number < 1) {
    issues.push(
      projectDatabaseError(
        "invalid_revision_number",
        `Revision number "${String(revision.number)}" is not a positive integer`,
        at(base, "number"),
      ),
    );
  }
  if (revision.basedOn !== undefined) {
    if (!isNonEmptyString(revision.basedOn)) {
      issues.push(
        projectDatabaseError(
          "empty_revision_reference",
          "Revision declares an empty basedOn reference",
          at(base, "basedOn"),
        ),
      );
    } else if (revision.basedOn === revision.id) {
      issues.push(
        projectDatabaseError(
          "self_revision_reference",
          "Revision names itself as its predecessor",
          at(base, "basedOn"),
        ),
      );
    }
  }
  if (revision.createdAt !== undefined) {
    issues.push(
      ...projectTimestampIssues(
        revision.createdAt,
        "created_time",
        "Revision declares an empty created time",
        at(base, "createdAt"),
      ),
    );
  }
  if (revision.author !== undefined && !isNonEmptyString(revision.author)) {
    issues.push(
      projectDatabaseError(
        "empty_revision_author",
        "Revision declares an empty author",
        at(base, "author"),
      ),
    );
  }
  if (revision.reason !== undefined && !isNonEmptyString(revision.reason)) {
    issues.push(
      projectDatabaseError(
        "empty_revision_reason",
        "Revision declares an empty reason",
        at(base, "reason"),
      ),
    );
  }

  if (!Array.isArray(revision.changes)) {
    issues.push(
      projectDatabaseError(
        "invalid_changes",
        "Revision changes must be a list",
        at(base, "changes"),
      ),
    );
  } else {
    revision.changes.forEach((change, index) => {
      issues.push(...validateProjectChange(change, at(base, `changes.${index}`)));
    });
  }

  return issues;
}

/**
 * Validate a record's whole revision history: every revision individually,
 * unique ids, strictly increasing sequence numbers, and an unbroken `basedOn`
 * chain — each revision that names a predecessor must name the revision
 * immediately before it. History is append-only; a break in the chain is
 * flagged, never repaired.
 */
export function validateProjectRevisions(
  revisions: readonly ProjectRevision[],
  base = "revisions",
): ProjectDatabaseIssue[] {
  if (!Array.isArray(revisions)) {
    return [projectDatabaseError("invalid_revisions", "Revision history must be a list", base)];
  }
  const issues: ProjectDatabaseIssue[] = [];
  const seenIds = new Set<string>();
  let previous: ProjectRevision | undefined;

  revisions.forEach((revision, index) => {
    issues.push(...validateProjectRevision(revision, `${base}.${index}`));
    if (isAbsent(revision)) return;

    if (isNonEmptyString(revision.id)) {
      if (seenIds.has(revision.id)) {
        issues.push(
          projectDatabaseError(
            "duplicate_revision_id",
            `Revision id "${revision.id}" appears more than once`,
            `${base}.${index}.id`,
          ),
        );
      }
      seenIds.add(revision.id);
    }

    if (previous !== undefined) {
      if (
        Number.isInteger(previous.number) &&
        Number.isInteger(revision.number) &&
        revision.number <= previous.number
      ) {
        issues.push(
          projectDatabaseError(
            "non_increasing_revisions",
            `Revision number ${String(revision.number)} does not increase past ${String(previous.number)} — history is append-only`,
            `${base}.${index}.number`,
          ),
        );
      }
      if (
        isNonEmptyString(revision.basedOn) &&
        isNonEmptyString(previous.id) &&
        revision.basedOn !== previous.id
      ) {
        issues.push(
          projectDatabaseError(
            "broken_revision_chain",
            `Revision "${String(revision.id)}" is based on "${revision.basedOn}" but follows "${previous.id}"`,
            `${base}.${index}.basedOn`,
          ),
        );
      }
    }
    previous = revision;
  });

  return issues;
}
