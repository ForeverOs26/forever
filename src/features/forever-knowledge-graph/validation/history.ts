/**
 * Forever Knowledge Graph — history validation.
 *
 * Structural guards over the {@link KnowledgeGraphHistory} shapes: an entry
 * must name its project, carry a known reused RC4.0 state, and reference its
 * graph coherently when it references one; a history must name its project
 * and every entry must belong to it. A structurally absent part is reported
 * as missing, never dereferenced. All checks return issues; none throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import type { KnowledgeGraphHistory, KnowledgeGraphHistoryEntry } from "../history";
import { isKnownKnowledgeGraphState } from "../result";
import { knowledgeError } from "../types";
import type { KnowledgeIssue } from "../types";

/**
 * Validate one history entry. `base` locates it; e.g. `entries.0`.
 *
 * Never throws: an entry so hostile it cannot even be read settles into one
 * structured issue.
 */
export function validateKnowledgeGraphHistoryEntry(
  entry: KnowledgeGraphHistoryEntry,
  base = "entry",
): KnowledgeIssue[] {
  try {
    return validateKnowledgeGraphHistoryEntryUnguarded(entry, base);
  } catch {
    return [
      knowledgeError(
        "unvalidatable_input",
        "History entry behaved in a way that could not be validated",
        base,
      ),
    ];
  }
}

function validateKnowledgeGraphHistoryEntryUnguarded(
  entry: KnowledgeGraphHistoryEntry,
  base: string,
): KnowledgeIssue[] {
  if (isAbsent(entry)) {
    return [knowledgeError("missing_history_entry", "History entry is absent", base)];
  }
  const issues: KnowledgeIssue[] = [];

  if (!isNonEmptyString(entry.projectId)) {
    issues.push(
      knowledgeError(
        "missing_history_project",
        "History entry names no canonical project",
        `${base}.projectId`,
      ),
    );
  }
  if (entry.graphId !== undefined && !isNonEmptyString(entry.graphId)) {
    issues.push(
      knowledgeError(
        "empty_graph_reference",
        "History entry declares an empty graph reference",
        `${base}.graphId`,
      ),
    );
  }
  if (!isKnownKnowledgeGraphState(entry.state)) {
    issues.push(
      knowledgeError(
        "unknown_history_state",
        `History entry has an unknown state "${String(entry.state)}"`,
        `${base}.state`,
      ),
    );
  }
  if (isAbsent(entry.stats)) {
    issues.push(
      knowledgeError("missing_history_stats", "History entry carries no counters", `${base}.stats`),
    );
  }
  for (const key of ["startedAt", "finishedAt"] as const) {
    const value = entry[key];
    if (value !== undefined && !isNonEmptyString(value)) {
      issues.push(
        knowledgeError(
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
export function validateKnowledgeGraphHistory(
  history: KnowledgeGraphHistory,
  base = "",
): KnowledgeIssue[] {
  try {
    return validateKnowledgeGraphHistoryUnguarded(history, base);
  } catch {
    return [
      knowledgeError(
        "unvalidatable_input",
        "Knowledge-graph history behaved in a way that could not be validated",
        base === "" ? "history" : base,
      ),
    ];
  }
}

function validateKnowledgeGraphHistoryUnguarded(
  history: KnowledgeGraphHistory,
  base: string,
): KnowledgeIssue[] {
  const at = (path: string) => (base === "" ? path : `${base}.${path}`);
  if (isAbsent(history)) {
    return [
      knowledgeError(
        "missing_history",
        "Knowledge-graph history is absent",
        base === "" ? "history" : base,
      ),
    ];
  }
  const issues: KnowledgeIssue[] = [];

  if (!isNonEmptyString(history.projectId)) {
    issues.push(
      knowledgeError(
        "missing_history_project",
        "History names no canonical project",
        at("projectId"),
      ),
    );
  }
  if (!Array.isArray(history.entries)) {
    issues.push(
      knowledgeError("invalid_history_entries", "History entries must be a list", at("entries")),
    );
    return issues;
  }
  // Indexed — never a hole-skipping iterator — so an absent slot is reported
  // as a missing entry instead of vanishing silently.
  for (let index = 0; index < history.entries.length; index += 1) {
    const entry = history.entries[index];
    const entryBase = at(`entries.${index}`);
    issues.push(...validateKnowledgeGraphHistoryEntry(entry, entryBase));
    if (
      !isAbsent(entry) &&
      isNonEmptyString(entry.projectId) &&
      isNonEmptyString(history.projectId) &&
      entry.projectId !== history.projectId
    ) {
      issues.push(
        knowledgeError(
          "history_project_mismatch",
          `History entry belongs to "${entry.projectId}", not "${history.projectId}"`,
          `${entryBase}.projectId`,
        ),
      );
    }
  }

  return issues;
}
