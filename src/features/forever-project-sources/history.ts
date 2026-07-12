/**
 * Forever Project Sources — history models.
 *
 * A {@link ProjectSourceHistory} is the append-only record of what one
 * catalogued document's standing settled into over time: registered, reviewed,
 * verified, superseded, archived, or rejected — each entry stamped with the
 * revision it concerned. RC4.4 defines the shape and pure, immutable helpers
 * for building it; it persists nothing and records no wall-clock time of its
 * own — timestamps are supplied by the caller so history stays deterministic.
 *
 * Mirrors the Forever Sync (RC3.2), Forever Pipeline (RC3.5), Forever Project
 * Integration (RC4.0), and Forever Project Factory (RC4.3) history shapes so a
 * source's log reads identically, while its `status` *is* the module's own
 * status vocabulary — no separate event taxonomy to drift out of sync.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ProjectSourceStatus } from "./status";
import type { ProjectSourceId } from "./types";
import type { ProjectSourceVersion } from "./version";

/** One settled standing of a catalogued document. */
export interface ProjectSourceHistoryEntry {
  sourceId: ProjectSourceId;
  /** The standing the document settled into. */
  status: ProjectSourceStatus;
  /** The revision this entry concerns, when one was addressed. */
  version?: ProjectSourceVersion;
  /** When the standing settled, supplied by the caller. */
  at?: ISODateTime;
  /** Free-text notes about the transition. */
  notes?: string;
}

/** The ordered history of every standing recorded for one source. */
export interface ProjectSourceHistory {
  sourceId: ProjectSourceId;
  entries: ProjectSourceHistoryEntry[];
}

/** An empty history for a source. */
export function emptyProjectSourceHistory(sourceId: ProjectSourceId): ProjectSourceHistory {
  return { sourceId, entries: [] };
}

/**
 * Append an entry, returning a new {@link ProjectSourceHistory}.
 *
 * Immutable: the input history is never mutated, so identical inputs always
 * yield an equal result and callers can share history freely.
 */
export function appendProjectSourceHistory(
  history: ProjectSourceHistory,
  entry: ProjectSourceHistoryEntry,
): ProjectSourceHistory {
  return { sourceId: history.sourceId, entries: [...history.entries, entry] };
}

/** The most recently appended entry, or `undefined` for an empty history. */
export function latestProjectSourceHistoryEntry(
  history: ProjectSourceHistory,
): ProjectSourceHistoryEntry | undefined {
  return history.entries.length > 0 ? history.entries[history.entries.length - 1] : undefined;
}
