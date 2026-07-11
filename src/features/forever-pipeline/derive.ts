/**
 * Forever Pipeline — deterministic state/outcome derivation.
 *
 * The single source of truth for turning a {@link PipelineStats} into a coarse
 * {@link PipelineOutcome} and a lifecycle {@link PipelineState}. Kept separate
 * from the state vocabulary so the enums stay dependency-free, and used by the
 * result builder so a run's counters and its reported state can never disagree.
 *
 * Pure and total: identical stats always map to the identical state/outcome,
 * with no clock, randomness, or hidden state.
 */

import type { PipelineOutcome, PipelineState } from "./state";
import type { PipelineStats } from "./types";

/**
 * Derive the coarse outcome of a run from its counters.
 *
 * Any error or failed step makes the run a `failure`, unless some steps still
 * completed — then it is `partial`. A clean run that completed nothing is a
 * `noop`; a clean run that completed something is a `success`.
 */
export function derivePipelineOutcome(stats: PipelineStats): PipelineOutcome {
  if (stats.errors > 0 || stats.failed > 0) {
    return stats.completed > 0 ? "partial" : "failure";
  }
  return stats.completed > 0 ? "success" : "noop";
}

/** Derive the terminal lifecycle state from a run's counters. */
export function derivePipelineState(stats: PipelineStats): PipelineState {
  switch (derivePipelineOutcome(stats)) {
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
