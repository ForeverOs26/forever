/**
 * Forever Sync — deterministic helpers.
 *
 * Pure, side-effect-free utilities shared across the foundation: stable key
 * builders for endpoints and jobs, a strict string guard used by validation,
 * and a stats combiner. Given the same input they always return the same
 * output — no randomness, no clocks, no locale — so the whole module stays
 * deterministic and these helpers never need re-implementing per call site.
 */

import { emptySyncStats } from "./result";
import type { SyncEndpoint, SyncJob, SyncStats } from "./types";

/** True only for a non-empty, non-whitespace string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Stable key for an endpoint: `system:protocol:id`. */
export function syncEndpointKey(endpoint: SyncEndpoint): string {
  return `${endpoint.system}:${endpoint.protocol}:${endpoint.id}`;
}

/** Whether two endpoints denote the same connection point (same id). */
export function isSameEndpoint(a: SyncEndpoint, b: SyncEndpoint): boolean {
  return a.id === b.id;
}

/** Stable key for a source→target system pairing. */
export function syncPairKey(source: SyncEndpoint, target: SyncEndpoint): string {
  return `${source.system}->${target.system}`;
}

/**
 * Stable identity for a job independent of its surrogate `id`:
 * `sourceSystem->targetSystem:entityKind:direction`. Two jobs that move the
 * same kind the same way between the same systems share a key.
 */
export function syncJobKey(job: SyncJob): string {
  return `${job.source.system}->${job.target.system}:${job.entityKind}:${job.direction}`;
}

/** Add two stat counters field-by-field into a fresh {@link SyncStats}. */
export function mergeSyncStats(a: SyncStats, b: SyncStats): SyncStats {
  return {
    total: a.total + b.total,
    synced: a.synced + b.synced,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed,
    conflicts: a.conflicts + b.conflicts,
    warnings: a.warnings + b.warnings,
    errors: a.errors + b.errors,
  };
}

/** Sum a list of stats into one, starting from an empty {@link SyncStats}. */
export function sumSyncStats(stats: readonly SyncStats[]): SyncStats {
  return stats.reduce<SyncStats>((acc, next) => mergeSyncStats(acc, next), emptySyncStats());
}
