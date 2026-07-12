/**
 * Forever Canonical Project Database — history models.
 *
 * A {@link ProjectHistory} is the append-only record of what a project's
 * described canonical operations settled into — merge descriptions, described
 * revisions, and snapshots, each pinned to the entities it concerned. RC4.6
 * defines the shape and pure, immutable helpers for building it; it persists
 * nothing and records no wall-clock time of its own — timestamps are supplied
 * by the caller so history stays deterministic and append-only: entries are
 * only ever added, never rewritten.
 *
 * Mirrors the Forever Sync (RC3.2), Forever Pipeline (RC3.5), Forever Project
 * Integration (RC4.0), Forever Project Factory (RC4.3), Forever Project
 * Sources (RC4.4), and Forever Extraction Pipeline (RC4.5) history shapes so
 * a canonical-database log reads identically, while its
 * `state`/`outcome`/`stats` *are* the reused RC4.0 vocabularies.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ProjectDatabaseOutcome, ProjectDatabaseState, ProjectDatabaseStats } from "./result";

/** One settled described operation over a project's canonical record. */
export interface ProjectHistoryEntry {
  /** Canonical id of the project the entry concerns, e.g. `proj_coralina`. */
  projectId: string;
  /** The described merge this entry records, when one was described. */
  mergeId?: string;
  /** The described revision this entry records, when one was described. */
  revisionId?: string;
  /** The snapshot this entry records, when one was taken. */
  snapshotId?: string;
  state: ProjectDatabaseState;
  outcome: ProjectDatabaseOutcome;
  startedAt?: ISODateTime;
  finishedAt?: ISODateTime;
  stats: ProjectDatabaseStats;
}

/** The ordered history of every described operation recorded for one project. */
export interface ProjectHistory {
  /** Canonical id of the project, e.g. `proj_coralina`. */
  projectId: string;
  entries: ProjectHistoryEntry[];
}

/** An empty history for a project. */
export function emptyProjectHistory(projectId: string): ProjectHistory {
  return { projectId, entries: [] };
}

/**
 * Append an entry, returning a new {@link ProjectHistory}.
 *
 * Immutable and append-only: the input history is never mutated, so identical
 * inputs always yield an equal result and callers can share history freely.
 */
export function appendProjectHistory(
  history: ProjectHistory,
  entry: ProjectHistoryEntry,
): ProjectHistory {
  return { projectId: history.projectId, entries: [...history.entries, entry] };
}

/** The most recently appended entry, or `undefined` for an empty history. */
export function latestProjectHistoryEntry(
  history: ProjectHistory,
): ProjectHistoryEntry | undefined {
  return history.entries.length > 0 ? history.entries[history.entries.length - 1] : undefined;
}
