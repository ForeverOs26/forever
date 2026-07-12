/**
 * Forever Project Integration — policy models.
 *
 * A {@link ProjectIntegrationPolicy} declares *how* an integration should
 * behave: whether a future runtime would run its stages one after another or in
 * parallel, how it reacts when a step fails, how a failed attempt would be
 * retried, and whether the run is allowed to do anything beyond planning. It is a
 * description consumed by a future runtime — RC4.0 runs nothing, retries nothing,
 * and (by default) describes a dry run that would never write.
 *
 * The policy reuses the neighbouring foundations rather than restating them: the
 * execution-mode and error-strategy vocabularies are the Forever Pipeline (RC3.5)
 * ones, and the retry shape is the Forever Sync (RC3.2) one. There is therefore
 * one canonical vocabulary for each concept across the whole system, and nothing
 * to drift out of sync.
 */

import type { SyncRetryPolicy } from "@/features/forever-sync";
import type {
  PipelineErrorStrategy,
  PipelineExecutionMode,
} from "@/features/forever-pipeline";

/**
 * How a future runtime would traverse an integration's stages. Reuses the RC3.5
 * execution-mode vocabulary.
 */
export type ProjectIntegrationExecutionMode = PipelineExecutionMode;

/**
 * How a future runtime reacts to a failing step. Reuses the RC3.5 error-strategy
 * vocabulary (`abort` stops the whole integration, `continue` proceeds
 * regardless, `isolate` skips the rest of the failing step's stage).
 */
export type ProjectIntegrationErrorStrategy = PipelineErrorStrategy;

/**
 * The full behavioural contract for an integration.
 *
 * `dryRunOnly` defaults to the safe posture the repository uses everywhere: plan
 * and validate, never write, until a write path is explicitly approved. `retry`
 * reuses the RC3.2 {@link SyncRetryPolicy} shape. `maxConcurrency` is a hint for
 * a future runtime, never a live limiter.
 */
export interface ProjectIntegrationPolicy {
  id: string;
  executionMode: ProjectIntegrationExecutionMode;
  onError: ProjectIntegrationErrorStrategy;
  retry: SyncRetryPolicy;
  /** When true, the run only ever plans; it must never persist. */
  dryRunOnly: boolean;
  /** Hint for how many stages/steps a runtime may run at once; must be > 0. */
  maxConcurrency?: number;
}

/**
 * A conservative default policy: run stages sequentially, abort on the first
 * failure, never retry, dry-run only.
 *
 * Pure and deterministic — the same call always returns an equal (fresh) object.
 * Callers override only what they need.
 */
export function defaultProjectIntegrationPolicy(
  overrides: Partial<ProjectIntegrationPolicy> = {},
): ProjectIntegrationPolicy {
  return {
    id: "default",
    executionMode: "sequential",
    onError: "abort",
    retry: { maxAttempts: 1, backoff: "none" },
    dryRunOnly: true,
    ...overrides,
  };
}
