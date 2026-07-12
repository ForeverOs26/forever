/**
 * Forever Cross-Source Validation — policy models.
 *
 * A {@link CrossValidationPolicy} declares *how* a future validation runtime
 * should behave around a batch: whether it would examine subjects one after
 * another or in parallel, how it reacts when an examination step fails, how a
 * failed attempt would be retried, and whether anything beyond describing is
 * allowed. It is a description consumed by a future runtime — RC4.7 runs
 * nothing, retries nothing, and (by default) describes a dry run that would
 * never write.
 *
 * The policy *is* the RC4.0 integration policy, reused wholesale rather than
 * restated — exactly as RC4.3, RC4.4, RC4.5, and RC4.6 reused it: the
 * execution-mode and error-strategy vocabularies are the Forever Pipeline
 * (RC3.5) ones and the retry shape is the Forever Sync (RC3.2) one, all
 * carried through the RC4.0 shape. There is therefore one canonical
 * vocabulary for each concept across the whole system, one default posture,
 * and one validation guard — nothing to drift out of sync. The *bars* an
 * examination applies are deliberately not here: they live in the separate
 * {@link import("./requirements").CrossValidationRequirements}, because how a
 * runtime traverses work and what a caller demands of the data answer
 * different questions.
 */

import type { SyncRetryPolicy } from "@/features/forever-sync";
import type {
  ProjectIntegrationErrorStrategy,
  ProjectIntegrationExecutionMode,
  ProjectIntegrationPolicy,
} from "@/features/forever-project-integration";

/**
 * How a future runtime would traverse an examination. Reuses the RC3.5
 * execution-mode vocabulary through RC4.0.
 */
export type CrossValidationExecutionMode = ProjectIntegrationExecutionMode;

/**
 * How a future runtime reacts to a failing examination step. Reuses the
 * RC3.5 error-strategy vocabulary through RC4.0.
 */
export type CrossValidationErrorStrategy = ProjectIntegrationErrorStrategy;

/** How a failed attempt would be retried. Reuses the RC3.2 retry shape. */
export type CrossValidationRetryPolicy = SyncRetryPolicy;

/**
 * The full behavioural contract for a cross-source examination.
 *
 * Reuses the RC4.0 {@link ProjectIntegrationPolicy} shape verbatim:
 * `dryRunOnly` defaults to the safe posture the repository uses everywhere —
 * describe and validate, never write, until a write path is explicitly
 * approved.
 */
export type CrossValidationPolicy = ProjectIntegrationPolicy;

// Reuse the RC4.0 conservative default (sequential, abort on first failure,
// never retry, dry-run only) under a cross-validation name — one safe default
// posture across the whole system, never a local variant.
export { defaultProjectIntegrationPolicy as defaultCrossValidationPolicy } from "@/features/forever-project-integration";
