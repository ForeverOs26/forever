/**
 * Forever Project Readiness — history validation.
 *
 * Structural guards over the {@link ReadinessHistory} shapes: an entry must
 * name its project, carry a known reused RC4.0 state, and reference its
 * report coherently when it references one; a history must name its project
 * and every entry must belong to it. A structurally absent part is reported
 * as missing, never dereferenced. All checks return issues; none throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import type { ReadinessHistory, ReadinessHistoryEntry } from "../history";
import { isKnownReadinessState } from "../result";
import { readinessError } from "../types";
import type { ReadinessIssue } from "../types";

/**
 * Validate one history entry. `base` locates it; e.g. `entries.0`.
 *
 * Never throws: an entry so hostile it cannot even be read settles into one
 * structured issue.
 */
export function validateReadinessHistoryEntry(
  entry: ReadinessHistoryEntry,
  base = "entry",
): ReadinessIssue[] {
  try {
    return validateReadinessHistoryEntryUnguarded(entry, base);
  } catch {
    return [
      readinessError(
        "unvalidatable_input",
        "History entry behaved in a way that could not be validated",
        base,
      ),
    ];
  }
}

function validateReadinessHistoryEntryUnguarded(
  entry: ReadinessHistoryEntry,
  base: string,
): ReadinessIssue[] {
  if (isAbsent(entry)) {
    return [readinessError("missing_history_entry", "History entry is absent", base)];
  }
  const issues: ReadinessIssue[] = [];

  if (!isNonEmptyString(entry.projectId)) {
    issues.push(
      readinessError(
        "missing_history_project",
        "History entry names no canonical project",
        `${base}.projectId`,
      ),
    );
  }
  if (entry.reportId !== undefined && !isNonEmptyString(entry.reportId)) {
    issues.push(
      readinessError(
        "empty_report_reference",
        "History entry declares an empty report reference",
        `${base}.reportId`,
      ),
    );
  }
  if (!isKnownReadinessState(entry.state)) {
    issues.push(
      readinessError(
        "unknown_history_state",
        `History entry has an unknown state "${String(entry.state)}"`,
        `${base}.state`,
      ),
    );
  }
  if (isAbsent(entry.stats)) {
    issues.push(
      readinessError("missing_history_stats", "History entry carries no counters", `${base}.stats`),
    );
  }
  for (const key of ["startedAt", "finishedAt"] as const) {
    const value = entry[key];
    if (value !== undefined && !isNonEmptyString(value)) {
      issues.push(
        readinessError(
          "empty_history_time",
          `History entry declares an empty ${key}`,
          `${base}.${key}`,
        ),
      );
    }
  }

  return issues;
}

/**
 * Validate a whole history. `base` locates it; empty when standalone.
 *
 * Never throws: a history so hostile it cannot even be read settles into one
 * structured issue.
 */
export function validateReadinessHistory(history: ReadinessHistory, base = ""): ReadinessIssue[] {
  try {
    return validateReadinessHistoryUnguarded(history, base);
  } catch {
    return [
      readinessError(
        "unvalidatable_input",
        "Readiness history behaved in a way that could not be validated",
        base === "" ? "history" : base,
      ),
    ];
  }
}

function validateReadinessHistoryUnguarded(
  history: ReadinessHistory,
  base: string,
): ReadinessIssue[] {
  const at = (path: string) => (base === "" ? path : `${base}.${path}`);
  if (isAbsent(history)) {
    return [
      readinessError(
        "missing_history",
        "Readiness history is absent",
        base === "" ? "history" : base,
      ),
    ];
  }
  const issues: ReadinessIssue[] = [];

  if (!isNonEmptyString(history.projectId)) {
    issues.push(
      readinessError(
        "missing_history_project",
        "History names no canonical project",
        at("projectId"),
      ),
    );
  }
  if (!Array.isArray(history.entries)) {
    issues.push(
      readinessError("invalid_history_entries", "History entries must be a list", at("entries")),
    );
    return issues;
  }
  // Indexed — never a hole-skipping iterator — so an absent slot is reported
  // as a missing entry instead of vanishing silently.
  for (let index = 0; index < history.entries.length; index += 1) {
    const entry = history.entries[index];
    const entryBase = at(`entries.${index}`);
    issues.push(...validateReadinessHistoryEntry(entry, entryBase));
    if (
      !isAbsent(entry) &&
      isNonEmptyString(entry.projectId) &&
      isNonEmptyString(history.projectId) &&
      entry.projectId !== history.projectId
    ) {
      issues.push(
        readinessError(
          "history_project_mismatch",
          `History entry belongs to "${entry.projectId}", not "${history.projectId}"`,
          `${entryBase}.projectId`,
        ),
      );
    }
  }

  return issues;
}
