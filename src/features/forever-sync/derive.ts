/**
 * Forever Sync — deterministic status/outcome derivation.
 *
 * The single source of truth for turning a {@link SyncStats} into a coarse
 * {@link SyncOutcome} and a lifecycle {@link SyncStatus}. Kept separate from the
 * status vocabulary so the enums stay dependency-free, and used by every result
 * builder so a run's counters and its reported status can never disagree.
 *
 * Pure and total: identical stats always map to the identical status/outcome,
 * with no clock, randomness, or hidden state.
 */

import type { SyncOutcome, SyncStatus } from "./status";
import type { SyncStats } from "./types";

/**
 * Derive the coarse outcome of a run from its counters.
 *
 * Any error or failed record makes the run a `failure`, unless some records
 * still synced — then it is `partial`. A clean run that moved nothing is a
 * `noop`; a clean run that moved something is a `success`.
 */
export function deriveSyncOutcome(stats: SyncStats): SyncOutcome {
  if (stats.errors > 0 || stats.failed > 0) {
    return stats.synced > 0 ? "partial" : "failure";
  }
  return stats.synced > 0 ? "success" : "noop";
}

/** Derive the terminal lifecycle status from a run's counters. */
export function deriveSyncStatus(stats: SyncStats): SyncStatus {
  switch (deriveSyncOutcome(stats)) {
    case "success":
      return "succeeded";
    case "partial":
      return "partial";
    case "failure":
      return "failed";
    case "noop":
      return "skipped";
  }
}
