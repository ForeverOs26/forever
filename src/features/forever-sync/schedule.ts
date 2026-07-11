/**
 * Forever Sync — schedule and trigger models.
 *
 * A {@link SyncSchedule} describes *when* a scheduled sync would run and a
 * {@link SyncTrigger} describes *what* starts it. These are declarative records
 * only: RC3.2 ships no cron parser, no scheduler, no timer, and no event
 * subscription. A `cronExpression` is stored verbatim and never evaluated; an
 * `event` name is stored verbatim and never subscribed to.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { SyncScheduleKind, SyncTriggerKind } from "./status";

/**
 * A description of when a scheduled sync would fire.
 *
 * Exactly one timing field is meaningful per `kind`; validation enforces the
 * pairing. No field is ever interpreted as a real point in time by the
 * foundation.
 */
export interface SyncSchedule {
  id: string;
  kind: SyncScheduleKind;
  /** For `kind: "cron"`: an opaque cron expression. Stored, never parsed. */
  cronExpression?: string;
  /** For `kind: "interval"`: seconds between runs. A descriptor, not a timer. */
  intervalSeconds?: number;
  /** For `kind: "once"`: when to run. A descriptor, never compared to a clock. */
  runAt?: ISODateTime;
  /** IANA timezone label for the schedule; never used to compute an instant. */
  timezone?: string;
}

/**
 * A description of what starts a sync job.
 *
 * A `scheduled` trigger references a {@link SyncSchedule} by id; `webhook` and
 * `on_change` triggers name an opaque `event`. The foundation dispatches
 * nothing — it only records the intent.
 */
export interface SyncTrigger {
  id: string;
  kind: SyncTriggerKind;
  /** Resolves to a {@link SyncSchedule} when `kind: "scheduled"`. */
  scheduleId?: string;
  /** Opaque event name for `webhook`/`on_change` triggers. Never subscribed to. */
  event?: string;
  enabled: boolean;
}
