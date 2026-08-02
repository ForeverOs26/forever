/**
 * Forever Studio — bounded automatic retries.
 *
 * WHAT WENT WRONG WITHOUT THIS
 * ----------------------------
 * The first real R2 production pilot failed deterministically and was retried
 * by the five-minute cron for as long as anyone let it. Seven attempts, all
 * identical, all doomed, and the only thing that stopped it was a human writing
 * `retryable = false` by hand. An automatic retry is for a TRANSIENT problem;
 * a defect that reproduces every time is not transient, and re-running it
 * forever buys nothing while making the failure look like an ongoing incident.
 *
 * WHAT THE CAP IS, AND WHAT IT IS NOT
 * -----------------------------------
 * It bounds CONSECUTIVE FAILED AUTOMATIC ATTEMPTS — the cron tick and the
 * dashboard's automatic resume. It is deliberately NOT:
 *
 *   - a cap on `attempt_count`. That column counts every CLAIM, and a large
 *     archive legitimately re-claims once per bounded slice, so capping it
 *     would strangle exactly the jobs that need the most attempts;
 *   - a cap on Owner-initiated processing. An Owner pressing Retry has made a
 *     decision, and the whole point of stopping the automatic loop is to hand
 *     that decision back to a person;
 *   - a licence to rewrite history. `attempt_count` is never reset, zeroed or
 *     adjusted by anything here. The record of what happened stays true.
 *
 * WHERE THE STATE LIVES
 * ---------------------
 * In the job's existing `facts` JSONB, next to the storage provider record that
 * already lives there. No migration, no new column, no backfill: a job with no
 * `retry` record has simply never failed automatically, which is the truth for
 * every job created before this policy existed.
 */

/** Consecutive failed AUTOMATIC attempts before a job stops being auto-selected. */
export const STUDIO_AUTOMATIC_RETRY_LIMIT = 5;

/** Key inside `studio_upload_jobs.facts` holding the automatic-retry budget. */
export const JOB_RETRY_FACTS_KEY = "retry";

/**
 * How an attempt was initiated.
 *
 * `controlled` is an explicit per-job request from a signed-in Owner or Trusted
 * Publisher (Studio's "Retry processing", or the first processing request after
 * upload). `automatic` is the scheduled runner or the dashboard's background
 * resume — nobody asked for this particular attempt right now.
 */
export type StudioAttemptKind = "automatic" | "controlled";

export interface StudioRetryFacts {
  /** Consecutive failed automatic attempts. Never negative, never fractional. */
  automaticFailures: number;
}

interface JobWithFacts {
  facts?: Record<string, unknown> | null;
}

/** Consecutive failed automatic attempts recorded on this job. Absent ⇒ 0. */
export function automaticFailureCount(job: JobWithFacts): number {
  const facts = (job.facts ?? {}) as Record<string, unknown>;
  const stored = (facts[JOB_RETRY_FACTS_KEY] as { automaticFailures?: unknown } | undefined)
    ?.automaticFailures;
  if (typeof stored !== "number" || !Number.isFinite(stored)) return 0;
  return Math.max(0, Math.trunc(stored));
}

/**
 * True when the automatic lane has spent its budget on this job.
 *
 * Checked BEFORE claiming, so an exhausted job is never claimed, never has its
 * `attempt_count` incremented, and never touches storage.
 */
export function automaticRetryBudgetExhausted(
  job: JobWithFacts,
  limit: number = STUDIO_AUTOMATIC_RETRY_LIMIT,
): boolean {
  return automaticFailureCount(job) >= limit;
}

/**
 * The budget after one failed attempt.
 *
 * A CONTROLLED attempt resets it to zero whatever the outcome: the Owner has
 * re-authorized this work, so the automatic lane starts fresh behind them. That
 * is the one and only way the budget is restored, and it costs nothing but a
 * person deciding.
 */
export function nextAutomaticFailureCount(job: JobWithFacts, kind: StudioAttemptKind): number {
  return kind === "controlled" ? 0 : automaticFailureCount(job) + 1;
}

/** The facts patch recording the budget. Merged, never replacing other facts. */
export function retryFactsPatch(automaticFailures: number): {
  [JOB_RETRY_FACTS_KEY]: StudioRetryFacts;
} {
  return {
    [JOB_RETRY_FACTS_KEY]: { automaticFailures: Math.max(0, Math.trunc(automaticFailures)) },
  };
}

/**
 * Whether this failure should also make the job non-retryable.
 *
 * Reaching the cap stops the automatic lane at BOTH ends: the application skips
 * the job before claiming it, and `retryable = false` makes the database's
 * due-job predicate stop returning it at all. The failure itself stays fully
 * visible on the row — status, error code, stage telemetry and the true
 * attempt count — because a job nobody is retrying still has to be explicable.
 *
 * An already-terminal failure (a refusal, a validation error) is unaffected:
 * it was never retryable and the cap has no opinion about it.
 */
export function retryableAfterFailure(input: {
  failureRetryable: boolean;
  nextAutomaticFailures: number;
  limit?: number;
}): boolean {
  if (!input.failureRetryable) return false;
  return input.nextAutomaticFailures < (input.limit ?? STUDIO_AUTOMATIC_RETRY_LIMIT);
}
