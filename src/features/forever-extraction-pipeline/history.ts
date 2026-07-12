/**
 * Forever Extraction Pipeline — history models.
 *
 * An {@link ExtractionHistory} is the append-only record of what a
 * definition's planned extractions settled into — including repeated attempts
 * over the same source, each pinned to the received revision it read. RC4.5
 * defines the shape and pure, immutable helpers for building it; it persists
 * nothing and records no wall-clock time of its own — timestamps are supplied
 * by the caller so history stays deterministic.
 *
 * Mirrors the Forever Sync (RC3.2), Forever Pipeline (RC3.5), Forever Project
 * Integration (RC4.0), Forever Project Factory (RC4.3), and Forever Project
 * Sources (RC4.4) history shapes so an extraction log reads identically,
 * while its `state`/`outcome`/`stats` *are* the reused RC4.0 vocabularies.
 */

import type { ISODateTime } from "@/features/forever-database";
import type { ProjectSourceId } from "@/features/forever-project-sources";

import type { ExtractionOutcome, ExtractionState, ExtractionStats } from "./result";
import type { ExtractionId } from "./types";
import type { ExtractionSourceVersion } from "./version";

/** One settled planned extraction of a definition. */
export interface ExtractionHistoryEntry {
  definitionId: ExtractionId;
  /** The planned extraction this entry records, when one was described. */
  planId?: string;
  /** The recipe the attempt followed, when one was resolved. */
  recipeId?: string;
  /** The RC4.4 catalogued source the attempt read, when one was resolved. */
  sourceId?: ProjectSourceId;
  /** The received revision the attempt read, when one was pinned. */
  sourceVersion?: ExtractionSourceVersion;
  state: ExtractionState;
  outcome: ExtractionOutcome;
  startedAt?: ISODateTime;
  finishedAt?: ISODateTime;
  stats: ExtractionStats;
}

/** The ordered history of every planned extraction recorded for one definition. */
export interface ExtractionHistory {
  definitionId: ExtractionId;
  entries: ExtractionHistoryEntry[];
}

/** An empty history for a definition. */
export function emptyExtractionHistory(definitionId: ExtractionId): ExtractionHistory {
  return { definitionId, entries: [] };
}

/**
 * Append an entry, returning a new {@link ExtractionHistory}.
 *
 * Immutable: the input history is never mutated, so identical inputs always
 * yield an equal result and callers can share history freely.
 */
export function appendExtractionHistory(
  history: ExtractionHistory,
  entry: ExtractionHistoryEntry,
): ExtractionHistory {
  return { definitionId: history.definitionId, entries: [...history.entries, entry] };
}

/** The most recently appended entry, or `undefined` for an empty history. */
export function latestExtractionHistoryEntry(
  history: ExtractionHistory,
): ExtractionHistoryEntry | undefined {
  return history.entries.length > 0 ? history.entries[history.entries.length - 1] : undefined;
}
