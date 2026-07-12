/**
 * Forever Cross-Source Validation — history validation.
 *
 * Structural guards over the {@link CrossValidationHistory} shapes: an entry
 * must name its project, carry a known reused RC4.0 state, and reference its
 * report coherently when it references one; a history must name its project
 * and every entry must belong to it. A structurally absent part is reported
 * as missing, never dereferenced. All checks return issues; none throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import type { CrossValidationHistory, CrossValidationHistoryEntry } from "../history";
import { isKnownCrossValidationState } from "../result";
import { crossValidationError } from "../types";
import type { CrossValidationIssue } from "../types";

/** Validate one history entry. `base` locates it; e.g. `entries.0`. */
export function validateCrossValidationHistoryEntry(
  entry: CrossValidationHistoryEntry,
  base = "entry",
): CrossValidationIssue[] {
  if (isAbsent(entry)) {
    return [crossValidationError("missing_history_entry", "History entry is absent", base)];
  }
  const issues: CrossValidationIssue[] = [];

  if (!isNonEmptyString(entry.projectId)) {
    issues.push(
      crossValidationError(
        "missing_history_project",
        "History entry names no canonical project",
        `${base}.projectId`,
      ),
    );
  }
  if (entry.reportId !== undefined && !isNonEmptyString(entry.reportId)) {
    issues.push(
      crossValidationError(
        "empty_report_reference",
        "History entry declares an empty report reference",
        `${base}.reportId`,
      ),
    );
  }
  if (!isKnownCrossValidationState(entry.state)) {
    issues.push(
      crossValidationError(
        "unknown_history_state",
        `History entry has an unknown state "${String(entry.state)}"`,
        `${base}.state`,
      ),
    );
  }
  if (isAbsent(entry.stats)) {
    issues.push(
      crossValidationError(
        "missing_history_stats",
        "History entry carries no counters",
        `${base}.stats`,
      ),
    );
  }
  for (const key of ["startedAt", "finishedAt"] as const) {
    const value = entry[key];
    if (value !== undefined && !isNonEmptyString(value)) {
      issues.push(
        crossValidationError(
          "empty_history_time",
          `History entry declares an empty ${key}`,
          `${base}.${key}`,
        ),
      );
    }
  }

  return issues;
}

/** Validate a whole history. `base` locates it; empty when standalone. */
export function validateCrossValidationHistory(
  history: CrossValidationHistory,
  base = "",
): CrossValidationIssue[] {
  const at = (path: string) => (base === "" ? path : `${base}.${path}`);
  if (isAbsent(history)) {
    return [
      crossValidationError(
        "missing_history",
        "Cross-validation history is absent",
        base === "" ? "history" : base,
      ),
    ];
  }
  const issues: CrossValidationIssue[] = [];

  if (!isNonEmptyString(history.projectId)) {
    issues.push(
      crossValidationError(
        "missing_history_project",
        "History names no canonical project",
        at("projectId"),
      ),
    );
  }
  if (!Array.isArray(history.entries)) {
    issues.push(
      crossValidationError(
        "invalid_history_entries",
        "History entries must be a list",
        at("entries"),
      ),
    );
    return issues;
  }
  history.entries.forEach((entry, index) => {
    const entryBase = at(`entries.${index}`);
    issues.push(...validateCrossValidationHistoryEntry(entry, entryBase));
    if (
      !isAbsent(entry) &&
      isNonEmptyString(entry.projectId) &&
      isNonEmptyString(history.projectId) &&
      entry.projectId !== history.projectId
    ) {
      issues.push(
        crossValidationError(
          "history_project_mismatch",
          `History entry belongs to "${entry.projectId}", not "${history.projectId}"`,
          `${entryBase}.projectId`,
        ),
      );
    }
  });

  return issues;
}
