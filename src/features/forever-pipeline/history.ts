/**
 * Forever Pipeline — history models.
 *
 * A {@link PipelineHistory} is the append-only record of what a pipeline's runs
 * settled into. RC3.5 defines the shape and pure, immutable helpers for building
 * it; it persists nothing and records no wall-clock time of its own — timestamps
 * are supplied by the caller so history stays deterministic.
 *
 * Mirrors the Forever Sync (RC3.2) history shape so a pipeline's run log and a
 * sync's run log read identically.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { PipelineOutcome, PipelineState } from "./state";
import type { PipelineId, PipelineStats } from "./types";

/** One settled run of a pipeline. */
export interface PipelineHistoryEntry {
  pipelineId: PipelineId;
  state: PipelineState;
  outcome: PipelineOutcome;
  startedAt?: ISODateTime;
  finishedAt?: ISODateTime;
  stats: PipelineStats;
}

/** The ordered history of every run recorded for one pipeline. */
export interface PipelineHistory {
  pipelineId: PipelineId;
  entries: PipelineHistoryEntry[];
}

/** An empty history for a pipeline. */
export function emptyPipelineHistory(pipelineId: PipelineId): PipelineHistory {
  return { pipelineId, entries: [] };
}

/**
 * Append an entry, returning a new {@link PipelineHistory}.
 *
 * Immutable: the input history is never mutated, so identical inputs always
 * yield an equal result and callers can share history freely.
 */
export function appendPipelineHistory(
  history: PipelineHistory,
  entry: PipelineHistoryEntry,
): PipelineHistory {
  return { pipelineId: history.pipelineId, entries: [...history.entries, entry] };
}

/** The most recently appended entry, or `undefined` for an empty history. */
export function latestPipelineHistoryEntry(
  history: PipelineHistory,
): PipelineHistoryEntry | undefined {
  return history.entries.length > 0 ? history.entries[history.entries.length - 1] : undefined;
}
