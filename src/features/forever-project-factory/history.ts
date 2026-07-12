/**
 * Forever Project Factory — history models.
 *
 * A {@link FactoryHistory} is the append-only record of what a factory's
 * planned builds settled into. RC4.3 defines the shape and pure, immutable
 * helpers for building it; it persists nothing and records no wall-clock time
 * of its own — timestamps are supplied by the caller so history stays
 * deterministic.
 *
 * Mirrors the Forever Sync (RC3.2), Forever Pipeline (RC3.5), and Forever
 * Project Integration (RC4.0) history shapes so a factory's build log reads
 * identically, while its `state`/`outcome`/`stats` *are* the reused RC4.0
 * vocabularies.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { FactoryOutcome, FactoryState, FactoryStats } from "./result";
import type { FactoryId } from "./types";

/** One settled planned build of a factory. */
export interface FactoryHistoryEntry {
  factoryId: FactoryId;
  /** The planned build this entry records, when one was described. */
  buildId?: string;
  /** The recipe the build followed, when one was resolved. */
  recipeId?: string;
  state: FactoryState;
  outcome: FactoryOutcome;
  startedAt?: ISODateTime;
  finishedAt?: ISODateTime;
  stats: FactoryStats;
}

/** The ordered history of every planned build recorded for one factory. */
export interface FactoryHistory {
  factoryId: FactoryId;
  entries: FactoryHistoryEntry[];
}

/** An empty history for a factory. */
export function emptyFactoryHistory(factoryId: FactoryId): FactoryHistory {
  return { factoryId, entries: [] };
}

/**
 * Append an entry, returning a new {@link FactoryHistory}.
 *
 * Immutable: the input history is never mutated, so identical inputs always
 * yield an equal result and callers can share history freely.
 */
export function appendFactoryHistory(
  history: FactoryHistory,
  entry: FactoryHistoryEntry,
): FactoryHistory {
  return { factoryId: history.factoryId, entries: [...history.entries, entry] };
}

/** The most recently appended entry, or `undefined` for an empty history. */
export function latestFactoryHistoryEntry(
  history: FactoryHistory,
): FactoryHistoryEntry | undefined {
  return history.entries.length > 0 ? history.entries[history.entries.length - 1] : undefined;
}
