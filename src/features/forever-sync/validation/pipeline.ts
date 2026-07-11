/**
 * Forever Sync — the validation pipeline.
 *
 * Composes the individual guards (job, policy, schedules, triggers, and the
 * canonical payload) into one deterministic pass over a {@link SyncPlan}. This
 * is the single entry point a job or connector calls before declaring a sync
 * safe to run. It never throws — it returns a structured verdict.
 *
 * Cross-references are resolved here: a job's `policyId` must match the supplied
 * policy, its `triggerIds` must resolve to supplied triggers, and a scheduled
 * trigger's `scheduleId` must resolve to a supplied schedule. Payload integrity
 * is delegated to the Forever Import (RC3.1) pipeline.
 */

import { partitionSyncIssues, syncError } from "../result";
import type { SyncError, SyncIssue, SyncWarning } from "../types";
import { validateSyncJob } from "./job";
import { validateSyncPayload } from "./payload";
import type { SyncPlan } from "./plan";
import { validateSyncPolicy } from "./policy";
import { validateSyncSchedule, validateSyncTrigger } from "./schedule";

/** The structured verdict of {@link validateSyncPlan}. */
export interface SyncValidation {
  valid: boolean;
  issues: SyncIssue[];
  errors: SyncError[];
  warnings: SyncWarning[];
}

/**
 * Run the full validation suite over a plan.
 *
 * Checks the job, the optional policy, every schedule and trigger, the
 * cross-references between them, and the optional canonical payload. Issues from
 * every check are merged in a stable order.
 */
export function validateSyncPlan(plan: SyncPlan): SyncValidation {
  const issues: SyncIssue[] = [];

  issues.push(...validateSyncJob(plan.job));

  if (plan.policy) issues.push(...validateSyncPolicy(plan.policy));

  const schedules = plan.schedules ?? [];
  for (const schedule of schedules) issues.push(...validateSyncSchedule(schedule));

  const scheduleIds = new Set(schedules.map((schedule) => schedule.id));
  const triggers = plan.triggers ?? [];
  for (const trigger of triggers) issues.push(...validateSyncTrigger(trigger, scheduleIds));

  if (plan.job.policyId !== undefined && plan.policy && plan.policy.id !== plan.job.policyId) {
    issues.push(
      syncError(
        "unresolved_policy",
        `job.policyId "${plan.job.policyId}" does not match the provided policy "${plan.policy.id}"`,
        "job.policyId",
      ),
    );
  }

  if (plan.job.triggerIds) {
    const triggerIds = new Set(triggers.map((trigger) => trigger.id));
    plan.job.triggerIds.forEach((triggerId, index) => {
      if (!triggerIds.has(triggerId)) {
        issues.push(
          syncError(
            "unresolved_trigger",
            `job.triggerIds "${triggerId}" does not resolve to a known trigger`,
            `job.triggerIds.${index}`,
          ),
        );
      }
    });
  }

  if (plan.payload) {
    issues.push(...validateSyncPayload(plan.payload, plan.scope ?? {}));
  }

  const { errors, warnings } = partitionSyncIssues(issues);
  return { valid: errors.length === 0, issues, errors, warnings };
}
