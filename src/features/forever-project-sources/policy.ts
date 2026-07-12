/**
 * Forever Project Sources — policy models.
 *
 * A {@link ProjectSourcePolicy} declares *how* a future intake runtime should
 * behave around a catalogued source or a whole catalogue: whether processing
 * would traverse work sequentially or in parallel, how it reacts when a step
 * fails, how a failed attempt would be retried, and whether anything beyond
 * planning is allowed. It is a description consumed by a future runtime —
 * RC4.4 runs nothing, retries nothing, and (by default) describes a dry run
 * that would never write.
 *
 * The policy *is* the RC4.0 integration policy, reused wholesale rather than
 * restated — exactly as RC4.3 reused it for factories: the execution-mode and
 * error-strategy vocabularies are the Forever Pipeline (RC3.5) ones and the
 * retry shape is the Forever Sync (RC3.2) one, all carried through the RC4.0
 * shape. There is therefore one canonical vocabulary for each concept across
 * the whole system, one default posture, and one validation guard — nothing to
 * drift out of sync.
 */

import type { SyncRetryPolicy } from "@/features/forever-sync";
import type {
  ProjectIntegrationErrorStrategy,
  ProjectIntegrationExecutionMode,
  ProjectIntegrationPolicy,
} from "@/features/forever-project-integration";

/**
 * How a future intake runtime would traverse work over a source. Reuses the
 * RC3.5 execution-mode vocabulary through RC4.0.
 */
export type ProjectSourceExecutionMode = ProjectIntegrationExecutionMode;

/**
 * How a future intake runtime reacts to a failing step. Reuses the RC3.5
 * error-strategy vocabulary through RC4.0.
 */
export type ProjectSourceErrorStrategy = ProjectIntegrationErrorStrategy;

/** How a failed attempt would be retried. Reuses the RC3.2 retry shape. */
export type ProjectSourceRetryPolicy = SyncRetryPolicy;

/**
 * The full behavioural contract for a catalogued source or catalogue.
 *
 * Reuses the RC4.0 {@link ProjectIntegrationPolicy} shape verbatim:
 * `dryRunOnly` defaults to the safe posture the repository uses everywhere —
 * describe and validate, never write, until a write path is explicitly
 * approved.
 */
export type ProjectSourcePolicy = ProjectIntegrationPolicy;

// Reuse the RC4.0 conservative default (sequential, abort on first failure,
// never retry, dry-run only) under a source-facing name — one safe default
// posture across the whole system, never a local variant.
export { defaultProjectIntegrationPolicy as defaultProjectSourcePolicy } from "@/features/forever-project-integration";
