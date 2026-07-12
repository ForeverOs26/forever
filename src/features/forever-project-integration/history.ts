/**
 * Forever Project Integration — history models.
 *
 * A {@link ProjectIntegrationHistory} is the append-only record of what an
 * integration's runs settled into. RC4.0 defines the shape and pure, immutable
 * helpers for building it; it persists nothing and records no wall-clock time of
 * its own — timestamps are supplied by the caller so history stays deterministic.
 *
 * Mirrors the Forever Sync (RC3.2) and Forever Pipeline (RC3.5) history shapes so
 * an integration's run log reads identically.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ProjectIntegrationOutcome, ProjectIntegrationState } from "./state";
import type { ProjectIntegrationId, ProjectIntegrationStats } from "./types";

/** One settled run of an integration. */
export interface ProjectIntegrationHistoryEntry {
  integrationId: ProjectIntegrationId;
  state: ProjectIntegrationState;
  outcome: ProjectIntegrationOutcome;
  startedAt?: ISODateTime;
  finishedAt?: ISODateTime;
  stats: ProjectIntegrationStats;
}

/** The ordered history of every run recorded for one integration. */
export interface ProjectIntegrationHistory {
  integrationId: ProjectIntegrationId;
  entries: ProjectIntegrationHistoryEntry[];
}

/** An empty history for an integration. */
export function emptyProjectIntegrationHistory(
  integrationId: ProjectIntegrationId,
): ProjectIntegrationHistory {
  return { integrationId, entries: [] };
}

/**
 * Append an entry, returning a new {@link ProjectIntegrationHistory}.
 *
 * Immutable: the input history is never mutated, so identical inputs always
 * yield an equal result and callers can share history freely.
 */
export function appendProjectIntegrationHistory(
  history: ProjectIntegrationHistory,
  entry: ProjectIntegrationHistoryEntry,
): ProjectIntegrationHistory {
  return { integrationId: history.integrationId, entries: [...history.entries, entry] };
}

/** The most recently appended entry, or `undefined` for an empty history. */
export function latestProjectIntegrationHistoryEntry(
  history: ProjectIntegrationHistory,
): ProjectIntegrationHistoryEntry | undefined {
  return history.entries.length > 0 ? history.entries[history.entries.length - 1] : undefined;
}
