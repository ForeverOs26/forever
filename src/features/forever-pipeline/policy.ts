/**
 * Forever Pipeline — policy models.
 *
 * A {@link PipelinePolicy} declares *how* a pipeline should behave: whether a
 * future runtime would run its stages one after another or in parallel, how it
 * reacts when a step fails, how a failed attempt would be retried, and whether
 * the run is allowed to do anything beyond planning. It is a description consumed
 * by a future runtime — RC3.5 runs nothing, retries nothing, and (by default)
 * describes a dry run that would never write.
 *
 * The retry shape is reused verbatim from Forever Sync (RC3.2) rather than
 * restated, so a pipeline and a sync describe backoff the same way and there is
 * one canonical retry vocabulary to validate.
 */

import type { SyncRetryPolicy } from "@/features/forever-sync";

/** How a future runtime would traverse a pipeline's stages. */
export type PipelineExecutionMode = "sequential" | "parallel";

/** Every {@link PipelineExecutionMode}, in a stable declared order. */
export const PIPELINE_EXECUTION_MODES = [
  "sequential",
  "parallel",
] as const satisfies readonly PipelineExecutionMode[];

/** Runtime guard: whether a value is a known {@link PipelineExecutionMode}. */
export function isKnownPipelineExecutionMode(value: unknown): value is PipelineExecutionMode {
  return (
    typeof value === "string" && (PIPELINE_EXECUTION_MODES as readonly string[]).includes(value)
  );
}

/**
 * How a future runtime reacts to a failing step.
 *
 * `abort` stops the whole pipeline, `continue` proceeds to later steps and
 * stages regardless, and `isolate` skips the rest of the failing step's stage
 * but still attempts later stages.
 */
export type PipelineErrorStrategy = "abort" | "continue" | "isolate";

/** Every {@link PipelineErrorStrategy}, in a stable declared order. */
export const PIPELINE_ERROR_STRATEGIES = [
  "abort",
  "continue",
  "isolate",
] as const satisfies readonly PipelineErrorStrategy[];

/** Runtime guard: whether a value is a known {@link PipelineErrorStrategy}. */
export function isKnownPipelineErrorStrategy(value: unknown): value is PipelineErrorStrategy {
  return (
    typeof value === "string" && (PIPELINE_ERROR_STRATEGIES as readonly string[]).includes(value)
  );
}

/**
 * The full behavioural contract for a pipeline.
 *
 * `dryRunOnly` defaults to the safe posture the repository uses everywhere: plan
 * and validate, never write, until a write path is explicitly approved. `retry`
 * reuses the RC3.2 {@link SyncRetryPolicy} shape. `maxConcurrency` is a hint for
 * a future runtime, never a live limiter.
 */
export interface PipelinePolicy {
  id: string;
  executionMode: PipelineExecutionMode;
  onError: PipelineErrorStrategy;
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
 * Pure and deterministic — the same call always returns an equal (fresh)
 * object. Callers override only what they need.
 */
export function defaultPipelinePolicy(overrides: Partial<PipelinePolicy> = {}): PipelinePolicy {
  return {
    id: "default",
    executionMode: "sequential",
    onError: "abort",
    retry: { maxAttempts: 1, backoff: "none" },
    dryRunOnly: true,
    ...overrides,
  };
}
