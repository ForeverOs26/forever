/**
 * Forever Sync — policy validation.
 *
 * Guards that a {@link SyncPolicy} is internally coherent: it has an id, a
 * sane retry budget, and non-degenerate numeric hints. These are structural
 * checks on the descriptor — RC3.2 never enacts the policy.
 */

import { isNonEmptyString } from "../helpers";
import type { SyncPolicy } from "../policy";
import { syncError } from "../result";
import type { SyncIssue } from "../types";

/** Validate a policy's id and numeric bounds. */
export function validateSyncPolicy(policy: SyncPolicy): SyncIssue[] {
  const issues: SyncIssue[] = [];
  if (!isNonEmptyString(policy.id)) {
    issues.push(syncError("missing_policy_id", "Sync policy is missing an id", "policy.id"));
  }
  if (!Number.isInteger(policy.retry.maxAttempts) || policy.retry.maxAttempts < 1) {
    issues.push(
      syncError(
        "invalid_retry",
        "Sync policy retry.maxAttempts must be an integer >= 1",
        "policy.retry.maxAttempts",
      ),
    );
  }
  if (
    policy.retry.initialDelayMs !== undefined &&
    (!Number.isFinite(policy.retry.initialDelayMs) || policy.retry.initialDelayMs < 0)
  ) {
    issues.push(
      syncError(
        "invalid_retry_delay",
        "Sync policy retry.initialDelayMs must be a number >= 0",
        "policy.retry.initialDelayMs",
      ),
    );
  }
  if (
    policy.batchSize !== undefined &&
    (!Number.isInteger(policy.batchSize) || policy.batchSize <= 0)
  ) {
    issues.push(
      syncError(
        "invalid_batch_size",
        "Sync policy batchSize must be a positive integer",
        "policy.batchSize",
      ),
    );
  }
  return issues;
}
