/**
 * Forever Sync — schedule and trigger validation.
 *
 * Guards that a {@link SyncSchedule} carries the timing field its `kind`
 * requires and that a {@link SyncTrigger} resolves to a known schedule when it
 * is scheduled. The `cronExpression` is only checked for presence — never
 * parsed — because RC3.2 ships no cron engine.
 */

import { isNonEmptyString } from "../helpers";
import { syncError, syncWarning } from "../result";
import type { SyncSchedule, SyncTrigger } from "../schedule";
import type { SyncIssue } from "../types";

/**
 * Validate a schedule's id and the timing field required by its kind.
 *
 * `cron` requires a `cronExpression`, `interval` a positive `intervalSeconds`,
 * and `once` a `runAt`. A `manual` schedule needs no timing field.
 */
export function validateSyncSchedule(schedule: SyncSchedule): SyncIssue[] {
  const issues: SyncIssue[] = [];
  if (!isNonEmptyString(schedule.id)) {
    issues.push(syncError("missing_schedule_id", "Sync schedule is missing an id", "schedule.id"));
  }
  switch (schedule.kind) {
    case "cron":
      if (!isNonEmptyString(schedule.cronExpression)) {
        issues.push(
          syncError(
            "missing_cron_expression",
            'A "cron" schedule requires a cronExpression',
            "schedule.cronExpression",
          ),
        );
      }
      break;
    case "interval":
      if (
        schedule.intervalSeconds === undefined ||
        !Number.isFinite(schedule.intervalSeconds) ||
        schedule.intervalSeconds <= 0
      ) {
        issues.push(
          syncError(
            "invalid_interval",
            'An "interval" schedule requires intervalSeconds > 0',
            "schedule.intervalSeconds",
          ),
        );
      }
      break;
    case "once":
      if (!isNonEmptyString(schedule.runAt)) {
        issues.push(
          syncError("missing_run_at", 'A "once" schedule requires runAt', "schedule.runAt"),
        );
      }
      break;
    case "manual":
      break;
  }
  return issues;
}

/**
 * Validate a trigger's id and, for a scheduled trigger, that its `scheduleId`
 * resolves within {@link scheduleIds}. A `webhook`/`on_change` trigger without a
 * named `event` is a warning, not a blocker.
 */
export function validateSyncTrigger(
  trigger: SyncTrigger,
  scheduleIds: ReadonlySet<string> = new Set(),
): SyncIssue[] {
  const issues: SyncIssue[] = [];
  if (!isNonEmptyString(trigger.id)) {
    issues.push(syncError("missing_trigger_id", "Sync trigger is missing an id", "trigger.id"));
  }
  if (trigger.kind === "scheduled") {
    if (!isNonEmptyString(trigger.scheduleId)) {
      issues.push(
        syncError(
          "missing_trigger_schedule",
          'A "scheduled" trigger requires a scheduleId',
          "trigger.scheduleId",
        ),
      );
    } else if (!scheduleIds.has(trigger.scheduleId)) {
      issues.push(
        syncError(
          "unresolved_schedule",
          `trigger.scheduleId "${trigger.scheduleId}" does not resolve to a known schedule`,
          "trigger.scheduleId",
        ),
      );
    }
  }
  if (
    (trigger.kind === "webhook" || trigger.kind === "on_change") &&
    !isNonEmptyString(trigger.event)
  ) {
    issues.push(
      syncWarning(
        "missing_trigger_event",
        `A "${trigger.kind}" trigger usually names an event`,
        "trigger.event",
      ),
    );
  }
  return issues;
}
