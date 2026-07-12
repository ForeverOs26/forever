/**
 * Forever Project Integration — deterministic state/outcome derivation.
 *
 * The single source of truth for turning a {@link ProjectIntegrationStats} into
 * a coarse {@link ProjectIntegrationOutcome} and a lifecycle
 * {@link ProjectIntegrationState}. Kept separate from the state vocabulary so the
 * enums stay dependency-free, and used by the result builder so a run's counters
 * and its reported state can never disagree.
 *
 * Pure and total: identical stats always map to the identical state/outcome,
 * with no clock, randomness, or hidden state.
 */

import type { ProjectIntegrationOutcome, ProjectIntegrationState } from "./state";
import type { ProjectIntegrationStats } from "./types";

/**
 * Derive the coarse outcome of a run from its counters.
 *
 * Any error or failed step makes the run a `failure`, unless some steps still
 * completed — then it is `partial`. A clean run that completed nothing is a
 * `noop`; a clean run that completed something is a `success`.
 */
export function deriveProjectIntegrationOutcome(
  stats: ProjectIntegrationStats,
): ProjectIntegrationOutcome {
  if (stats.errors > 0 || stats.failed > 0) {
    return stats.completed > 0 ? "partial" : "failure";
  }
  return stats.completed > 0 ? "success" : "noop";
}

/** Derive the terminal lifecycle state from a run's counters. */
export function deriveProjectIntegrationState(
  stats: ProjectIntegrationStats,
): ProjectIntegrationState {
  switch (deriveProjectIntegrationOutcome(stats)) {
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
