/**
 * Forever Sync — status and lifecycle enumerations.
 *
 * The closed vocabularies that describe where a sync run is in its lifecycle,
 * how it ended, and how the foundation is configured to behave. Every value is
 * explicit so downstream automation stays deterministic and comparable — there
 * are no free-text status strings.
 *
 * These are types and small pure predicates only. RC3.2 never transitions a
 * status at runtime, runs a scheduler, or executes a retry; it defines the
 * vocabulary a future runtime will move through.
 */

/**
 * The lifecycle state of a sync run.
 *
 * `idle`/`pending`/`running` are pre-terminal; the rest are terminal outcomes a
 * run settles into. RC3.2 assigns them deterministically from stats and never
 * advances them over time.
 */
export type SyncStatus =
  | "idle"
  | "pending"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "skipped"
  | "cancelled";

/** The terminal states a sync run can finish in. */
export const SYNC_TERMINAL_STATUSES = [
  "succeeded",
  "partial",
  "failed",
  "skipped",
  "cancelled",
] as const satisfies readonly SyncStatus[];

/** Whether a status is terminal (the run has finished). */
export function isTerminalSyncStatus(status: SyncStatus): boolean {
  return (SYNC_TERMINAL_STATUSES as readonly SyncStatus[]).includes(status);
}

/**
 * The coarse outcome of a run, independent of its detailed lifecycle state.
 *
 * `noop` means nothing needed syncing; `partial` means some records synced and
 * some failed.
 */
export type SyncOutcome = "success" | "partial" | "failure" | "noop";

/** Whether an outcome represents a clean run (nothing failed). */
export function isSuccessfulOutcome(outcome: SyncOutcome): boolean {
  return outcome === "success" || outcome === "noop";
}

/**
 * How a {@link import("./policy").SyncPolicy} resolves a record that differs
 * between source and target. RC3.2 defines the choices; it resolves nothing.
 */
export type SyncConflictStrategy =
  | "source_wins"
  | "target_wins"
  | "newest_wins"
  | "manual"
  | "skip";

/** What causes a sync job to start. Descriptor only — nothing is dispatched. */
export type SyncTriggerKind = "manual" | "scheduled" | "webhook" | "on_change" | "on_import";

/**
 * The shape of a schedule. `cron` carries an opaque expression string that the
 * foundation stores but never parses or evaluates.
 */
export type SyncScheduleKind = "interval" | "cron" | "once" | "manual";
