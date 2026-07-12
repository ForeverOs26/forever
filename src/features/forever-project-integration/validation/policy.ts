/**
 * Forever Project Integration — policy validation.
 *
 * Guards that a {@link ProjectIntegrationPolicy} is well-formed: the
 * `executionMode` and `onError` strategy must be known values, the reused Forever
 * Sync (RC3.2) retry shape must allow at least one attempt with a known backoff,
 * and `maxConcurrency` (when present) must be a positive integer. All checks
 * return issues; none throw.
 *
 * The execution-mode and error-strategy guards are the Forever Pipeline (RC3.5)
 * ones — the integration policy reuses that vocabulary, so validation reuses that
 * runtime guard rather than duplicating it. RC3.2 exposes {@link SyncBackoff} as a
 * type only, so the backoff list is pinned to that type with `satisfies`.
 */

import type { SyncBackoff } from "@/features/forever-sync";
import {
  isKnownPipelineErrorStrategy,
  isKnownPipelineExecutionMode,
} from "@/features/forever-pipeline";

import type { ProjectIntegrationPolicy } from "../policy";
import { projectIntegrationError } from "../result";
import type { ProjectIntegrationIssue } from "../types";

/** The RC3.2 backoff shapes, mirrored for runtime guarding and pinned to the type. */
const KNOWN_BACKOFFS = ["none", "fixed", "exponential"] as const satisfies readonly SyncBackoff[];

function isKnownBackoff(value: unknown): boolean {
  return typeof value === "string" && (KNOWN_BACKOFFS as readonly string[]).includes(value);
}

/** Validate an integration policy's mode, error strategy, retry, and concurrency. */
export function validateProjectIntegrationPolicy(
  policy: ProjectIntegrationPolicy,
): ProjectIntegrationIssue[] {
  const issues: ProjectIntegrationIssue[] = [];

  if (!isKnownPipelineExecutionMode(policy.executionMode)) {
    issues.push(
      projectIntegrationError(
        "unknown_execution_mode",
        `Integration policy has an unknown execution mode "${String(policy.executionMode)}"`,
        "policy.executionMode",
      ),
    );
  }
  if (!isKnownPipelineErrorStrategy(policy.onError)) {
    issues.push(
      projectIntegrationError(
        "unknown_error_strategy",
        `Integration policy has an unknown error strategy "${String(policy.onError)}"`,
        "policy.onError",
      ),
    );
  }
  if (!Number.isInteger(policy.retry.maxAttempts) || policy.retry.maxAttempts < 1) {
    issues.push(
      projectIntegrationError(
        "invalid_retry_attempts",
        "Integration policy retry maxAttempts must be an integer >= 1",
        "policy.retry.maxAttempts",
      ),
    );
  }
  if (!isKnownBackoff(policy.retry.backoff)) {
    issues.push(
      projectIntegrationError(
        "unknown_backoff",
        `Integration policy has an unknown backoff "${String(policy.retry.backoff)}"`,
        "policy.retry.backoff",
      ),
    );
  }
  if (
    policy.maxConcurrency !== undefined &&
    (!Number.isInteger(policy.maxConcurrency) || policy.maxConcurrency < 1)
  ) {
    issues.push(
      projectIntegrationError(
        "invalid_max_concurrency",
        "Integration policy maxConcurrency must be a positive integer",
        "policy.maxConcurrency",
      ),
    );
  }

  return issues;
}
