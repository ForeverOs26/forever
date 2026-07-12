/**
 * Forever Canonical Project Database — policy models.
 *
 * A {@link ProjectDatabasePolicy} declares *how* a future canonical-database
 * runtime should behave around a record: whether it would work through
 * described merges one after another or in parallel, how it reacts when a
 * described change cannot settle, how a failed attempt would be retried, and
 * whether anything beyond describing is allowed. It is a description consumed
 * by a future runtime — RC4.6 runs nothing, retries nothing, and (by default)
 * describes a dry run that would never write.
 *
 * The policy *is* the RC4.0 integration policy, reused wholesale rather than
 * restated — exactly as RC4.3, RC4.4, and RC4.5 reused it: the execution-mode
 * and error-strategy vocabularies are the Forever Pipeline (RC3.5) ones and
 * the retry shape is the Forever Sync (RC3.2) one, all carried through the
 * RC4.0 shape. There is therefore one canonical vocabulary for each concept
 * across the whole system, one default posture, and one validation guard —
 * nothing to drift out of sync.
 */

import type { SyncRetryPolicy } from "@/features/forever-sync";
import type {
  ProjectIntegrationErrorStrategy,
  ProjectIntegrationExecutionMode,
  ProjectIntegrationPolicy,
} from "@/features/forever-project-integration";

/**
 * How a future runtime would traverse described merges. Reuses the RC3.5
 * execution-mode vocabulary through RC4.0.
 */
export type ProjectDatabaseExecutionMode = ProjectIntegrationExecutionMode;

/**
 * How a future runtime reacts to a change that cannot settle. Reuses the
 * RC3.5 error-strategy vocabulary through RC4.0.
 */
export type ProjectDatabaseErrorStrategy = ProjectIntegrationErrorStrategy;

/** How a failed attempt would be retried. Reuses the RC3.2 retry shape. */
export type ProjectDatabaseRetryPolicy = SyncRetryPolicy;

/**
 * The full behavioural contract for the canonical database.
 *
 * Reuses the RC4.0 {@link ProjectIntegrationPolicy} shape verbatim:
 * `dryRunOnly` defaults to the safe posture the repository uses everywhere —
 * describe and validate, never write, until a write path is explicitly
 * approved.
 */
export type ProjectDatabasePolicy = ProjectIntegrationPolicy;

// Reuse the RC4.0 conservative default (sequential, abort on first failure,
// never retry, dry-run only) under a canonical-database name — one safe
// default posture across the whole system, never a local variant.
export { defaultProjectIntegrationPolicy as defaultProjectDatabasePolicy } from "@/features/forever-project-integration";
