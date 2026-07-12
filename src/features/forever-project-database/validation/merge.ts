/**
 * Forever Canonical Project Database — merge validation.
 *
 * Structural guards over one {@link ProjectMerge}: the identity references
 * must be present, the described revision must be coherent and belong to the
 * same project, every entry must classify under a known kind with the values
 * its kind requires (an applied movement must say what would stand, a met
 * value must be shown, a rejection must say why), no incoming fact may be
 * classified twice, every described conflict must genuinely disagree and
 * correspond one-to-one with a `conflicting` entry, the revision's change
 * list must account for exactly the movements the entries classify, and the
 * merged fields must be individually coherent with no duplicated path. A
 * structurally absent part is reported as missing, never dereferenced. All
 * checks return issues; none throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import type { ProjectMerge, ProjectMergeEntry } from "../merge";
import { isKnownProjectMergeEntryKind } from "../merge";
import { projectDatabaseError, projectDatabaseWarning } from "../types";
import type { ProjectDatabaseIssue } from "../types";
import { projectFieldValueSignature } from "../value";
import { validateProjectField } from "./field";
import { validateProjectRevision } from "./revision";
import { validateProjectFieldValue } from "./value";

function at(base: string, path: string): string {
  return base === "" ? path : `${base}.${path}`;
}

function validateMergeEntry(entry: ProjectMergeEntry, base: string): ProjectDatabaseIssue[] {
  if (isAbsent(entry)) {
    return [projectDatabaseError("missing_merge_entry", "Merge entry is absent", base)];
  }
  const issues: ProjectDatabaseIssue[] = [];

  if (!isKnownProjectMergeEntryKind(entry.kind)) {
    issues.push(
      projectDatabaseError(
        "unknown_merge_entry_kind",
        `Merge entry has an unknown kind "${String(entry.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  // A rejected fact may have been too malformed to carry a usable id at all;
  // every other classification must name the fact it classifies.
  if (!isNonEmptyString(entry.factId) && entry.kind !== "rejected") {
    issues.push(
      projectDatabaseError(
        "missing_entry_fact",
        "Merge entry names no incoming fact",
        `${base}.factId`,
      ),
    );
  }
  if (entry.path !== undefined && !isNonEmptyString(entry.path)) {
    issues.push(
      projectDatabaseError(
        "empty_entry_path",
        "Merge entry declares an empty path",
        `${base}.path`,
      ),
    );
  }
  if (entry.fieldId !== undefined && !isNonEmptyString(entry.fieldId)) {
    issues.push(
      projectDatabaseError(
        "empty_field_reference",
        "Merge entry declares an empty field reference",
        `${base}.fieldId`,
      ),
    );
  }

  if (entry.incoming !== undefined) {
    issues.push(...validateProjectFieldValue(entry.incoming, `${base}.incoming`));
  }
  if (entry.existing !== undefined) {
    issues.push(...validateProjectFieldValue(entry.existing, `${base}.existing`));
  }

  // Kind coherence: what an entry claims must match the values it shows.
  const needsIncoming =
    entry.kind === "added" ||
    entry.kind === "updated" ||
    entry.kind === "removed" ||
    entry.kind === "conflicting";
  if (needsIncoming && entry.incoming === undefined) {
    issues.push(
      projectDatabaseError(
        "merge_entry_without_incoming",
        `Merge entry is ${String(entry.kind)} but shows no incoming value`,
        `${base}.incoming`,
      ),
    );
  }
  const needsExisting =
    entry.kind === "updated" ||
    entry.kind === "removed" ||
    entry.kind === "unchanged" ||
    entry.kind === "conflicting";
  if (needsExisting && entry.existing === undefined) {
    issues.push(
      projectDatabaseError(
        "merge_entry_without_existing",
        `Merge entry is ${String(entry.kind)} but shows no existing value`,
        `${base}.existing`,
      ),
    );
  }
  if (entry.kind === "rejected" && !isNonEmptyString(entry.reason)) {
    issues.push(
      projectDatabaseWarning(
        "rejected_without_reason",
        "Merge entry is rejected but states no reason",
        `${base}.reason`,
      ),
    );
  }

  return issues;
}

/** Validate a whole merge description. `base` locates it; empty when standalone. */
export function validateProjectMerge(merge: ProjectMerge, base = ""): ProjectDatabaseIssue[] {
  if (isAbsent(merge)) {
    return [
      projectDatabaseError(
        "missing_merge",
        "Merge description is absent",
        base === "" ? "merge" : base,
      ),
    ];
  }
  const issues: ProjectDatabaseIssue[] = [];

  if (!isNonEmptyString(merge.id)) {
    issues.push(
      projectDatabaseError(
        "missing_merge_id",
        "Merge description is missing an id",
        at(base, "id"),
      ),
    );
  }
  if (!isNonEmptyString(merge.projectId)) {
    issues.push(
      projectDatabaseError(
        "missing_merge_project",
        "Merge description names no canonical project",
        at(base, "projectId"),
      ),
    );
  }
  if (!isNonEmptyString(merge.recordId)) {
    issues.push(
      projectDatabaseError(
        "missing_merge_record",
        "Merge description names no canonical record",
        at(base, "recordId"),
      ),
    );
  }

  if (isAbsent(merge.revision)) {
    issues.push(
      projectDatabaseError(
        "missing_merge_revision",
        "Merge description carries no described revision",
        at(base, "revision"),
      ),
    );
  } else {
    issues.push(...validateProjectRevision(merge.revision, at(base, "revision")));
    if (
      isNonEmptyString(merge.revision.projectId) &&
      isNonEmptyString(merge.projectId) &&
      merge.revision.projectId !== merge.projectId
    ) {
      issues.push(
        projectDatabaseError(
          "revision_project_mismatch",
          `Described revision belongs to "${merge.revision.projectId}", not "${merge.projectId}"`,
          at(base, "revision.projectId"),
        ),
      );
    }
  }

  const kindCounts = new Map<string, number>();
  const conflictingFactIds = new Set<string>();
  if (!Array.isArray(merge.entries)) {
    issues.push(
      projectDatabaseError(
        "invalid_merge_entries",
        "Merge entries must be a list",
        at(base, "entries"),
      ),
    );
  } else {
    // At most one non-rejected classification per fact id. Rejected entries
    // may repeat an id — rejecting a duplicate is exactly how a repeated
    // fact is described — so they neither seed nor trip the check.
    const seenFactIds = new Set<string>();
    merge.entries.forEach((entry, index) => {
      issues.push(...validateMergeEntry(entry, at(base, `entries.${index}`)));
      if (isAbsent(entry)) return;
      if (isNonEmptyString(entry.factId) && entry.kind !== "rejected") {
        if (seenFactIds.has(entry.factId)) {
          issues.push(
            projectDatabaseError(
              "duplicate_fact_reference",
              `Incoming fact "${entry.factId}" is classified more than once`,
              at(base, `entries.${index}.factId`),
            ),
          );
        }
        seenFactIds.add(entry.factId);
        if (entry.kind === "conflicting") conflictingFactIds.add(entry.factId);
      }
      if (typeof entry.kind === "string") {
        kindCounts.set(entry.kind, (kindCounts.get(entry.kind) ?? 0) + 1);
      }
    });
  }

  if (!Array.isArray(merge.conflicts)) {
    issues.push(
      projectDatabaseError(
        "invalid_merge_conflicts",
        "Merge conflicts must be a list",
        at(base, "conflicts"),
      ),
    );
  } else {
    merge.conflicts.forEach((conflict, index) => {
      const conflictBase = at(base, `conflicts.${index}`);
      if (isAbsent(conflict)) {
        issues.push(
          projectDatabaseError("missing_conflict", "Described conflict is absent", conflictBase),
        );
        return;
      }
      if (!isNonEmptyString(conflict.path)) {
        issues.push(
          projectDatabaseError(
            "missing_conflict_path",
            "Conflict addresses no canonical path",
            `${conflictBase}.path`,
          ),
        );
      }
      if (!isNonEmptyString(conflict.fieldId)) {
        issues.push(
          projectDatabaseError(
            "missing_conflict_field",
            "Conflict names no canonical field",
            `${conflictBase}.fieldId`,
          ),
        );
      }
      if (!isNonEmptyString(conflict.factId)) {
        issues.push(
          projectDatabaseError(
            "missing_conflict_fact",
            "Conflict names no incoming fact",
            `${conflictBase}.factId`,
          ),
        );
      } else if (Array.isArray(merge.entries) && !conflictingFactIds.has(conflict.factId)) {
        issues.push(
          projectDatabaseError(
            "unmatched_conflict",
            `Conflict names fact "${conflict.factId}" but no conflicting entry classifies it`,
            `${conflictBase}.factId`,
          ),
        );
      }
      let existingBroken = true;
      if (isAbsent(conflict.existing)) {
        issues.push(
          projectDatabaseError(
            "missing_conflict_existing",
            "Conflict shows no standing value",
            `${conflictBase}.existing`,
          ),
        );
      } else {
        const existingIssues = validateProjectFieldValue(
          conflict.existing,
          `${conflictBase}.existing`,
        );
        issues.push(...existingIssues);
        existingBroken = existingIssues.some((issue) => issue.severity === "error");
      }
      let incomingBroken = true;
      if (isAbsent(conflict.incoming)) {
        issues.push(
          projectDatabaseError(
            "missing_conflict_incoming",
            "Conflict shows no incoming value",
            `${conflictBase}.incoming`,
          ),
        );
      } else {
        const incomingIssues = validateProjectFieldValue(
          conflict.incoming,
          `${conflictBase}.incoming`,
        );
        issues.push(...incomingIssues);
        incomingBroken = incomingIssues.some((issue) => issue.severity === "error");
      }
      // Disagreement is only judgeable between two coherent readings — a
      // side already reported as broken is never re-reported as agreement.
      if (
        !existingBroken &&
        !incomingBroken &&
        projectFieldValueSignature(conflict.existing) ===
          projectFieldValueSignature(conflict.incoming)
      ) {
        issues.push(
          projectDatabaseError(
            "non_conflicting_values",
            "Conflict shows two byte-identical readings — nothing disagrees",
            conflictBase,
          ),
        );
      }
    });
    // One-to-one: every conflicting entry must be described as a conflict.
    if (Array.isArray(merge.entries) && merge.conflicts.length !== conflictingFactIds.size) {
      issues.push(
        projectDatabaseError(
          "unaccounted_conflict",
          `Merge classifies ${conflictingFactIds.size} conflicting facts but describes ${merge.conflicts.length} conflicts`,
          at(base, "conflicts"),
        ),
      );
    }
  }

  // The described revision must account for exactly the movements the
  // entries classify: added/updated/removed/unchanged/rejected each map to
  // one change of the same kind; conflicts move nothing.
  if (
    !isAbsent(merge.revision) &&
    Array.isArray(merge.revision.changes) &&
    Array.isArray(merge.entries)
  ) {
    for (const kind of ["added", "updated", "removed", "unchanged", "rejected"] as const) {
      const entryCount = kindCounts.get(kind) ?? 0;
      const changeCount = merge.revision.changes.filter(
        (change) => !isAbsent(change) && change.kind === kind,
      ).length;
      if (entryCount !== changeCount) {
        issues.push(
          projectDatabaseError(
            "inconsistent_merge_changes",
            `Merge classifies ${entryCount} ${kind} facts but its revision describes ${changeCount} ${kind} changes`,
            at(base, "revision.changes"),
          ),
        );
      }
    }
  }

  if (!Array.isArray(merge.mergedFields)) {
    issues.push(
      projectDatabaseError(
        "invalid_merged_fields",
        "Merged fields must be a list",
        at(base, "mergedFields"),
      ),
    );
  } else {
    const seenPaths = new Set<string>();
    merge.mergedFields.forEach((field, index) => {
      issues.push(...validateProjectField(field, at(base, `mergedFields.${index}`)));
      const path = field?.path;
      if (isNonEmptyString(path)) {
        if (seenPaths.has(path)) {
          issues.push(
            projectDatabaseError(
              "duplicate_field_path",
              `Merged fields describe the path "${path}" more than once`,
              at(base, `mergedFields.${index}.path`),
            ),
          );
        }
        seenPaths.add(path);
      }
    });
  }

  return issues;
}
