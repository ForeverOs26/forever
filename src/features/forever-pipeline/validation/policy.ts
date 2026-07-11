/**
 * Forever Pipeline — policy validation.
 *
 * Guards that a {@link PipelinePolicy} is well-formed: the `executionMode` and
 * `onError` strategy must be known values, the reused Forever Sync (RC3.2) retry
 * shape must allow at least one attempt with a known backoff, and
 * `maxConcurrency` (when present) must be a positive integer. All checks return
 * issues; none throw.
 *
 * RC3.2 exposes {@link SyncBackoff} as a type only, so the guard list is pinned
 * to that type with `satisfies` — the retry vocabulary stays coupled to the
 * shared one rather than duplicated.
 */

import type { SyncBackoff } from "@/features/forever-sync";

import {
  isKnownPipelineErrorStrategy,
  isKnownPipelineExecutionMode,
  type PipelinePolicy,
} from "../policy";
import { pipelineError } from "../result";
import type { PipelineIssue } from "../types";

/** The RC3.2 backoff shapes, mirrored for runtime guarding and pinned to the type. */
const KNOWN_BACKOFFS = ["none", "fixed", "exponential"] as const satisfies readonly SyncBackoff[];

function isKnownBackoff(value: unknown): boolean {
  return typeof value === "string" && (KNOWN_BACKOFFS as readonly string[]).includes(value);
}

/** Validate a pipeline policy's mode, error strategy, retry, and concurrency. */
export function validatePipelinePolicy(policy: PipelinePolicy): PipelineIssue[] {
  const issues: PipelineIssue[] = [];

  if (!isKnownPipelineExecutionMode(policy.executionMode)) {
    issues.push(
      pipelineError(
        "unknown_execution_mode",
        `Pipeline policy has an unknown execution mode "${String(policy.executionMode)}"`,
        "policy.executionMode",
      ),
    );
  }
  if (!isKnownPipelineErrorStrategy(policy.onError)) {
    issues.push(
      pipelineError(
        "unknown_error_strategy",
        `Pipeline policy has an unknown error strategy "${String(policy.onError)}"`,
        "policy.onError",
      ),
    );
  }
  if (!Number.isInteger(policy.retry.maxAttempts) || policy.retry.maxAttempts < 1) {
    issues.push(
      pipelineError(
        "invalid_retry_attempts",
        "Pipeline policy retry maxAttempts must be an integer >= 1",
        "policy.retry.maxAttempts",
      ),
    );
  }
  if (!isKnownBackoff(policy.retry.backoff)) {
    issues.push(
      pipelineError(
        "unknown_backoff",
        `Pipeline policy has an unknown backoff "${String(policy.retry.backoff)}"`,
        "policy.retry.backoff",
      ),
    );
  }
  if (
    policy.maxConcurrency !== undefined &&
    (!Number.isInteger(policy.maxConcurrency) || policy.maxConcurrency < 1)
  ) {
    issues.push(
      pipelineError(
        "invalid_max_concurrency",
        "Pipeline policy maxConcurrency must be a positive integer",
        "policy.maxConcurrency",
      ),
    );
  }

  return issues;
}
