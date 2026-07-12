/**
 * Forever Cross-Source Validation — history models.
 *
 * A {@link CrossValidationHistory} is the append-only record of what a
 * project's described examinations settled into, each pinned to the report it
 * concerned. RC4.7 defines the shape and pure, immutable helpers for building
 * it; it persists nothing and records no wall-clock time of its own —
 * timestamps are supplied by the caller so history stays deterministic and
 * append-only: entries are only ever added, never rewritten.
 *
 * Mirrors the Forever Sync (RC3.2), Forever Pipeline (RC3.5), Forever Project
 * Integration (RC4.0), Forever Project Factory (RC4.3), Forever Project
 * Sources (RC4.4), Forever Extraction Pipeline (RC4.5), and Forever Canonical
 * Project Database (RC4.6) history shapes so a cross-validation log reads
 * identically, while its `state`/`outcome`/`stats` *are* the reused RC4.0
 * vocabularies.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { CrossValidationReport } from "./report";
import type {
  CrossValidationOutcome,
  CrossValidationResult,
  CrossValidationState,
  CrossValidationStats,
} from "./result";

/** One settled described examination for a project. */
export interface CrossValidationHistoryEntry {
  /** Canonical id of the project the entry concerns, e.g. `proj_coralina`. */
  projectId: string;
  /** The described report this entry records, when one was described. */
  reportId?: string;
  state: CrossValidationState;
  outcome: CrossValidationOutcome;
  startedAt?: ISODateTime;
  finishedAt?: ISODateTime;
  stats: CrossValidationStats;
}

/** The ordered history of every described examination recorded for one project. */
export interface CrossValidationHistory {
  /** Canonical id of the project, e.g. `proj_coralina`. */
  projectId: string;
  entries: CrossValidationHistoryEntry[];
}

/** An empty history for a project. */
export function emptyCrossValidationHistory(projectId: string): CrossValidationHistory {
  return { projectId, entries: [] };
}

/**
 * Append an entry, returning a new {@link CrossValidationHistory}.
 *
 * Immutable and append-only: the input history is never mutated, so identical
 * inputs always yield an equal result and callers can share history freely.
 */
export function appendCrossValidationHistory(
  history: CrossValidationHistory,
  entry: CrossValidationHistoryEntry,
): CrossValidationHistory {
  return { projectId: history.projectId, entries: [...history.entries, entry] };
}

/** The most recently appended entry, or `undefined` for an empty history. */
export function latestCrossValidationHistoryEntry(
  history: CrossValidationHistory,
): CrossValidationHistoryEntry | undefined {
  return history.entries.length > 0 ? history.entries[history.entries.length - 1] : undefined;
}

/** Options accepted by {@link crossValidationHistoryEntry}. */
export interface CrossValidationHistoryOptions {
  /** When the described examination started, supplied by the caller. */
  startedAt?: ISODateTime;
  /** When the described examination finished, supplied by the caller. */
  finishedAt?: ISODateTime;
}

/**
 * Derive the {@link CrossValidationHistoryEntry} a described examination
 * settles into.
 *
 * Pure glue between {@link import("./report").describeCrossSourceValidation}
 * and the history model: it copies the result's settled state, outcome, and
 * counters, and attaches the report reference (and caller-supplied
 * timestamps) only when present, so an absent fact stays absent. An
 * examination that never resolved a project carries no project reference, so
 * the entry's required `projectId` is left empty — a stated blank the history
 * validator flags, never an invented project.
 */
export function crossValidationHistoryEntry(
  result: CrossValidationResult<CrossValidationReport>,
  options: CrossValidationHistoryOptions = {},
): CrossValidationHistoryEntry {
  const entry: CrossValidationHistoryEntry = {
    projectId: result.metadata.projectId ?? "",
    state: result.state,
    outcome: result.outcome,
    // Copied, never aliased: mutating a history entry's counters must not
    // reach back into the result it was derived from.
    stats: { ...result.stats },
  };
  if (result.metadata.reportId !== undefined) entry.reportId = result.metadata.reportId;
  if (options.startedAt !== undefined) entry.startedAt = options.startedAt;
  if (options.finishedAt !== undefined) entry.finishedAt = options.finishedAt;
  return entry;
}
