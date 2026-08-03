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

import type { StudioAutomaticRetryState } from "../studio-types";

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

/**
 * The persisted automatic-lane state — the whole point of this module.
 *
 * The vocabulary itself lives in `studio-types.ts` because three readers share
 * it and must never disagree: this module, the DATABASE
 * (`studio_job_automatic_retry_exhausted` reads this exact literal out of the
 * job's `facts` JSONB, so `studio_list_due_jobs` and `studio_count_active_jobs`
 * never return or count a job the scheduler would skip), and the dashboard.
 *
 * It is deliberately a STATE and not a threshold comparison. If the database
 * had to re-derive "failures >= limit" it would carry a second copy of the
 * limit, and the two copies would drift the first time anyone tuned it. The
 * DECISION is made once, here, by the code that records the failure; the
 * database only reads the answer.
 */
export type { StudioAutomaticRetryState } from "../studio-types";

/** Key inside `facts.retry` the SQL predicate reads. Changing it needs a migration. */
export const JOB_RETRY_AUTOMATIC_KEY = "automatic";

export interface StudioRetryFacts {
  /** Consecutive failed automatic attempts. Never negative, never fractional. */
  automaticFailures: number;
  /** The closed state the database reads. Always written with the count. */
  automatic: StudioAutomaticRetryState;
}

interface JobWithFacts {
  facts?: Record<string, unknown> | null;
}

function retryFacts(job: JobWithFacts): Record<string, unknown> {
  const facts = (job.facts ?? {}) as Record<string, unknown>;
  const stored = facts[JOB_RETRY_FACTS_KEY];
  return typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
}

/** Consecutive failed automatic attempts recorded on this job. Absent ⇒ 0. */
export function automaticFailureCount(job: JobWithFacts): number {
  const stored = retryFacts(job).automaticFailures;
  if (typeof stored !== "number" || !Number.isFinite(stored)) return 0;
  return Math.max(0, Math.trunc(stored));
}

/**
 * The job's automatic-lane state, read EXACTLY as the SQL predicate reads it.
 *
 * Anything that is not the literal `"exhausted"` — absent, malformed, a value
 * from some future version — is `eligible`, because that is what
 * `studio_job_automatic_retry_exhausted` returns for the same input. There is
 * deliberately NO fallback to the numeric streak: a fallback the database does
 * not share is drift by construction, and the count and the state are only ever
 * written together by `retryFactsPatch`.
 */
export function automaticRetryState(job: JobWithFacts): StudioAutomaticRetryState {
  return retryFacts(job)[JOB_RETRY_AUTOMATIC_KEY] === "exhausted" ? "exhausted" : "eligible";
}

/**
 * True when the automatic lane has spent its budget on this job.
 *
 * Checked BEFORE claiming, so an exhausted job is never claimed, never has its
 * `attempt_count` incremented, and never touches storage — belt and braces
 * behind the database predicate, which has already declined to return it.
 */
export function automaticRetryBudgetExhausted(job: JobWithFacts): boolean {
  return automaticRetryState(job) === "exhausted";
}

/**
 * Where one job stands with BOTH lanes — the canonical three-way answer.
 *
 * `automatically_exhausted` and `terminally_nonretryable` are deliberately not
 * one boolean. The first means "the automatic lane has given up; a person still
 * can". The second means "nobody can, until the underlying state is repaired".
 * Collapsing them is what made `retryable = false` do two jobs at once and
 * silently close the Owner's lane.
 */
export type StudioJobRetryDisposition =
  | "automatically_eligible"
  | "automatically_exhausted"
  | "terminally_nonretryable";

export function jobRetryDisposition(
  job: JobWithFacts & { retryable: boolean },
): StudioJobRetryDisposition {
  if (!job.retryable) return "terminally_nonretryable";
  return automaticRetryState(job) === "exhausted"
    ? "automatically_exhausted"
    : "automatically_eligible";
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

/**
 * The facts patch recording the budget. Merged, never replacing other facts.
 *
 * The count and the state are derived from ONE number and written together, so
 * there is no way to persist a pair that disagrees with itself — and therefore
 * no way for the row the database reads to disagree with the code that wrote
 * it.
 */
export function retryFactsPatch(
  automaticFailures: number,
  limit: number = STUDIO_AUTOMATIC_RETRY_LIMIT,
): { [JOB_RETRY_FACTS_KEY]: StudioRetryFacts } {
  const failures = Math.max(0, Math.trunc(automaticFailures));
  return {
    [JOB_RETRY_FACTS_KEY]: {
      automaticFailures: failures,
      [JOB_RETRY_AUTOMATIC_KEY]: failures >= limit ? "exhausted" : "eligible",
    },
  };
}

/**
 * What `retryable` a capped failure should record.
 *
 * THE CAP MUST NOT TOUCH THIS, AND HERE IS WHY.
 *
 * `retryable` is not the automatic lane's flag. It is the DATABASE's admission
 * predicate for BOTH lanes: `studio_claim_job` accepts a failed row only while
 * `retryable IS TRUE`, and `studio_request_job_processing` — the Owner pressing
 * "Retry processing" — simply delegates to it. Nothing in the application ever
 * writes `retryable` back to true. So a cap that set it to false would close the
 * Owner's lane permanently and leave direct SQL as the only way back: precisely
 * the manual intervention this module exists to remove, reintroduced from the
 * other direction.
 *
 * Stopping the automatic lane does not need it. `automaticRetryBudgetExhausted`
 * already skips a capped job before it is claimed, in the scheduled runner and
 * in the dashboard's background resume alike, so the loop stops at the
 * application boundary where the budget actually lives. The database keeps
 * offering the row; nobody automatic takes it; a person still can.
 *
 * A failure's own retryability is therefore passed through untouched. An
 * already-terminal failure (a refusal, a validation error) stays terminal
 * because it was never retryable, and the cap has no opinion about it.
 */
export function retryableAfterFailure(input: {
  failureRetryable: boolean;
  nextAutomaticFailures: number;
  limit?: number;
}): boolean {
  return input.failureRetryable;
}
