/**
 * Forever Sync — history models.
 *
 * A {@link SyncHistory} is the append-only record of what a job's runs settled
 * into. RC3.2 defines the shape and pure, immutable helpers for building it; it
 * persists nothing and records no wall-clock time of its own — timestamps are
 * supplied by the caller so history stays deterministic.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { SyncOutcome, SyncStatus } from "./status";
import type { SyncStats } from "./types";

/** One settled run of a sync job. */
export interface SyncHistoryEntry {
  jobId: string;
  status: SyncStatus;
  outcome: SyncOutcome;
  startedAt?: ISODateTime;
  finishedAt?: ISODateTime;
  stats: SyncStats;
}

/** The ordered history of every run recorded for one job. */
export interface SyncHistory {
  jobId: string;
  entries: SyncHistoryEntry[];
}

/** An empty history for a job. */
export function emptySyncHistory(jobId: string): SyncHistory {
  return { jobId, entries: [] };
}

/**
 * Append an entry, returning a new {@link SyncHistory}.
 *
 * Immutable: the input history is never mutated, so identical inputs always
 * yield an equal result and callers can share history freely.
 */
export function appendSyncHistory(history: SyncHistory, entry: SyncHistoryEntry): SyncHistory {
  return { jobId: history.jobId, entries: [...history.entries, entry] };
}

/** The most recently appended entry, or `undefined` for an empty history. */
export function latestSyncHistoryEntry(history: SyncHistory): SyncHistoryEntry | undefined {
  return history.entries.length > 0 ? history.entries[history.entries.length - 1] : undefined;
}
