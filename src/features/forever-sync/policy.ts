/**
 * Forever Sync — policy models.
 *
 * A {@link SyncPolicy} declares *how* a sync should behave: how conflicts are
 * resolved, how a failed attempt would be retried, and what the run is allowed
 * to do. It is a description consumed by a future runtime — RC3.2 resolves no
 * conflict, retries nothing, and (by default) plans a dry run that would never
 * write.
 */

import type { SyncConflictStrategy } from "./status";

/** Backoff shape a future runtime would apply between retry attempts. */
export type SyncBackoff = "none" | "fixed" | "exponential";

/**
 * Retry description. Values are declarative: the foundation never sleeps,
 * schedules, or re-invokes anything. `initialDelayMs` is a hint for a future
 * runtime, not a timer.
 */
export interface SyncRetryPolicy {
  /** Total attempts a runtime may make; must be an integer >= 1. */
  maxAttempts: number;
  backoff: SyncBackoff;
  initialDelayMs?: number;
}

/**
 * The full behavioural contract for a sync job.
 *
 * `dryRunOnly` defaults to the safe posture the repository uses everywhere:
 * plan and validate, never write, until a write path is explicitly approved.
 * `allowDeletes` must be opted into so a sync can never silently remove target
 * records.
 */
export interface SyncPolicy {
  id: string;
  conflictStrategy: SyncConflictStrategy;
  retry: SyncRetryPolicy;
  /** When false, a run that would delete target records is a blocking error. */
  allowDeletes: boolean;
  /** When true, the run only ever plans; it must never persist. */
  dryRunOnly: boolean;
  /** Hint for how many records a runtime would move per batch; must be > 0. */
  batchSize?: number;
}

/**
 * A conservative default policy: manual conflict resolution, no retries, no
 * deletes, dry-run only.
 *
 * Pure and deterministic — the same call always returns an equal (fresh)
 * object. Callers override only what they need.
 */
export function defaultSyncPolicy(overrides: Partial<SyncPolicy> = {}): SyncPolicy {
  return {
    id: "default",
    conflictStrategy: "manual",
    retry: { maxAttempts: 1, backoff: "none" },
    allowDeletes: false,
    dryRunOnly: true,
    ...overrides,
  };
}
