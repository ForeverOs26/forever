/**
 * Forever Project Readiness — policy models.
 *
 * A {@link ReadinessPolicy} declares *how* a future gate runtime should
 * behave around an examination: whether it would evaluate statements one
 * after another or in parallel, how it reacts when a step fails, how a
 * failed attempt would be retried, and whether anything beyond describing is
 * allowed. It is a description consumed by a future runtime — RC4.9 runs
 * nothing, retries nothing, and (by default) describes a dry run that would
 * never write.
 *
 * The policy *is* the RC4.0 integration policy, reused wholesale rather than
 * restated — exactly as RC4.3, RC4.4, RC4.5, RC4.6, RC4.7, and RC4.8 reused
 * it: the execution-mode and error-strategy vocabularies are the Forever
 * Pipeline (RC3.5) ones and the retry shape is the Forever Sync (RC3.2) one,
 * all carried through the RC4.0 shape and the RC4.6 re-exports. There is
 * therefore one canonical vocabulary for each concept across the whole
 * system, one default posture, and one validation guard — nothing to drift
 * out of sync.
 */

import type {
  ProjectDatabaseErrorStrategy,
  ProjectDatabaseExecutionMode,
  ProjectDatabasePolicy,
  ProjectDatabaseRetryPolicy,
} from "@/features/forever-project-database";

/**
 * How a future runtime would traverse an examination. Reuses the RC3.5
 * execution-mode vocabulary through RC4.0 and the RC4.6 alias.
 */
export type ReadinessExecutionMode = ProjectDatabaseExecutionMode;

/**
 * How a future runtime reacts to a failing examination step. Reuses the
 * RC3.5 error-strategy vocabulary through RC4.0 and the RC4.6 alias.
 */
export type ReadinessErrorStrategy = ProjectDatabaseErrorStrategy;

/** How a failed attempt would be retried. Reuses the RC3.2 retry shape. */
export type ReadinessRetryPolicy = ProjectDatabaseRetryPolicy;

/**
 * The full behavioural contract for a readiness examination.
 *
 * Reuses the RC4.0 policy shape verbatim (through the RC4.6 alias):
 * `dryRunOnly` defaults to the safe posture the repository uses everywhere —
 * describe and validate, never write, until a write path is explicitly
 * approved.
 */
export type ReadinessPolicy = ProjectDatabasePolicy;

// Reuse the RC4.0 conservative default (sequential, abort on first failure,
// never retry, dry-run only) under a readiness name — one safe default
// posture across the whole system, never a local variant.
export { defaultProjectDatabasePolicy as defaultReadinessPolicy } from "@/features/forever-project-database";
