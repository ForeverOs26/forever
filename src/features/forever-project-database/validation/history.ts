/**
 * Forever Canonical Project Database — history validation.
 *
 * Structural guards over a {@link ProjectHistory}: the project reference must
 * be present, every entry must name the same project, carry a known reused
 * RC4.0 lifecycle state and well-formed counters, and settle consistently —
 * the reused RC4.0 derivation rules judge whether an entry's state and
 * outcome agree with its own counters, so a log can never quietly claim a
 * different settlement than its numbers show (flagged as warnings, never
 * repaired). A structurally absent part is reported as missing, never
 * dereferenced. All checks return issues; none throw.
 */

import type { ProjectHistory, ProjectHistoryEntry } from "../history";
import { isAbsent, isNonEmptyString } from "../helpers";
import {
  deriveProjectDatabaseOutcome,
  deriveProjectDatabaseState,
  emptyProjectDatabaseStats,
  isKnownProjectDatabaseState,
} from "../result";
import type { ProjectDatabaseStats } from "../result";
import { projectDatabaseError, projectDatabaseWarning } from "../types";
import type { ProjectDatabaseIssue } from "../types";
import { projectTimestampIssues } from "./value";

/** The counter keys of the reused RC4.0 stats shape, derived from it. */
const STAT_KEYS = Object.keys(emptyProjectDatabaseStats()) as (keyof ProjectDatabaseStats)[];

function validateHistoryStats(
  stats: ProjectDatabaseStats,
  base: string,
): { issues: ProjectDatabaseIssue[]; usable: boolean } {
  const issues: ProjectDatabaseIssue[] = [];
  let usable = true;
  for (const key of STAT_KEYS) {
    const counter = stats[key];
    if (!Number.isInteger(counter) || counter < 0) {
      usable = false;
      issues.push(
        projectDatabaseError(
          "invalid_history_stats",
          `History entry counter "${key}" is "${String(counter)}", not a non-negative integer`,
          `${base}.${key}`,
        ),
      );
    }
  }
  return { issues, usable };
}

/** Validate one history entry. `base` locates it, e.g. `entries.0`. */
export function validateProjectHistoryEntry(
  entry: ProjectHistoryEntry,
  base = "entry",
): ProjectDatabaseIssue[] {
  if (isAbsent(entry)) {
    return [projectDatabaseError("missing_history_entry", "History entry is absent", base)];
  }
  const issues: ProjectDatabaseIssue[] = [];

  if (!isNonEmptyString(entry.projectId)) {
    issues.push(
      projectDatabaseError(
        "missing_history_project",
        "History entry names no canonical project",
        `${base}.projectId`,
      ),
    );
  }
  for (const [key, code] of [
    ["mergeId", "empty_merge_reference"],
    ["revisionId", "empty_revision_reference"],
    ["snapshotId", "empty_snapshot_reference"],
  ] as const) {
    const value = entry[key];
    if (value !== undefined && !isNonEmptyString(value)) {
      issues.push(
        projectDatabaseError(code, `History entry declares an empty ${key}`, `${base}.${key}`),
      );
    }
  }

  if (!isKnownProjectDatabaseState(entry.state)) {
    issues.push(
      projectDatabaseError(
        "unknown_history_state",
        `History entry has an unknown state "${String(entry.state)}"`,
        `${base}.state`,
      ),
    );
  }

  if (isAbsent(entry.stats)) {
    issues.push(
      projectDatabaseError(
        "missing_history_stats",
        "History entry carries no counters",
        `${base}.stats`,
      ),
    );
  } else {
    const { issues: statsIssues, usable } = validateHistoryStats(entry.stats, `${base}.stats`);
    issues.push(...statsIssues);
    // Settlement consistency: the reused RC4.0 rules derive state and outcome
    // from counters, so an entry that claims a different settlement than its
    // own numbers show is flagged — never repaired.
    if (usable) {
      if (
        isKnownProjectDatabaseState(entry.state) &&
        entry.state !== deriveProjectDatabaseState(entry.stats)
      ) {
        issues.push(
          projectDatabaseWarning(
            "inconsistent_history_state",
            `History entry claims state "${entry.state}" but its counters derive "${deriveProjectDatabaseState(entry.stats)}"`,
            `${base}.state`,
          ),
        );
      }
      if (entry.outcome !== deriveProjectDatabaseOutcome(entry.stats)) {
        issues.push(
          projectDatabaseWarning(
            "inconsistent_history_outcome",
            `History entry claims outcome "${String(entry.outcome)}" but its counters derive "${deriveProjectDatabaseOutcome(entry.stats)}"`,
            `${base}.outcome`,
          ),
        );
      }
    }
  }

  if (entry.startedAt !== undefined) {
    issues.push(
      ...projectTimestampIssues(
        entry.startedAt,
        "started_time",
        "History entry declares an empty started time",
        `${base}.startedAt`,
      ),
    );
  }
  if (entry.finishedAt !== undefined) {
    issues.push(
      ...projectTimestampIssues(
        entry.finishedAt,
        "finished_time",
        "History entry declares an empty finished time",
        `${base}.finishedAt`,
      ),
    );
  }
  if (
    isNonEmptyString(entry.startedAt) &&
    isNonEmptyString(entry.finishedAt) &&
    entry.finishedAt < entry.startedAt
  ) {
    issues.push(
      projectDatabaseWarning(
        "history_time_order",
        "History entry finishes before it starts",
        `${base}.finishedAt`,
      ),
    );
  }

  return issues;
}

/** Validate a whole history: the project reference and every entry. */
export function validateProjectHistory(
  history: ProjectHistory,
  base = "history",
): ProjectDatabaseIssue[] {
  if (isAbsent(history)) {
    return [projectDatabaseError("missing_history", "History is absent", base)];
  }
  const issues: ProjectDatabaseIssue[] = [];

  if (!isNonEmptyString(history.projectId)) {
    issues.push(
      projectDatabaseError(
        "missing_history_project",
        "History names no canonical project",
        `${base}.projectId`,
      ),
    );
  }

  if (!Array.isArray(history.entries)) {
    issues.push(
      projectDatabaseError(
        "invalid_history_entries",
        "History entries must be a list",
        `${base}.entries`,
      ),
    );
    return issues;
  }

  history.entries.forEach((entry, index) => {
    const entryBase = `${base}.entries.${index}`;
    issues.push(...validateProjectHistoryEntry(entry, entryBase));
    if (
      !isAbsent(entry) &&
      isNonEmptyString(entry.projectId) &&
      isNonEmptyString(history.projectId) &&
      entry.projectId !== history.projectId
    ) {
      issues.push(
        projectDatabaseError(
          "history_project_mismatch",
          `History entry belongs to "${entry.projectId}", not "${history.projectId}"`,
          `${entryBase}.projectId`,
        ),
      );
    }
  });

  return issues;
}
