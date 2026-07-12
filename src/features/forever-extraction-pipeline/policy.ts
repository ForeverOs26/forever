/**
 * Forever Extraction Pipeline — policy models.
 *
 * An {@link ExtractionPolicy} declares *how* a future extraction runtime
 * should behave around a definition: whether it would traverse a recipe's
 * stages one after another or in parallel, how it reacts when a step fails,
 * how a failed attempt would be retried, and whether anything beyond planning
 * is allowed. It is a description consumed by a future runtime — RC4.5 runs
 * nothing, retries nothing, and (by default) describes a dry run that would
 * never write.
 *
 * The policy *is* the RC4.0 integration policy, reused wholesale rather than
 * restated — exactly as RC4.3 and RC4.4 reused it: the execution-mode and
 * error-strategy vocabularies are the Forever Pipeline (RC3.5) ones and the
 * retry shape is the Forever Sync (RC3.2) one, all carried through the RC4.0
 * shape. There is therefore one canonical vocabulary for each concept across
 * the whole system, one default posture, and one validation guard — nothing
 * to drift out of sync.
 */

import type { SyncRetryPolicy } from "@/features/forever-sync";
import type {
  ProjectIntegrationErrorStrategy,
  ProjectIntegrationExecutionMode,
  ProjectIntegrationPolicy,
} from "@/features/forever-project-integration";

/**
 * How a future runtime would traverse a recipe's stages. Reuses the RC3.5
 * execution-mode vocabulary through RC4.0.
 */
export type ExtractionExecutionMode = ProjectIntegrationExecutionMode;

/**
 * How a future runtime reacts to a failing step. Reuses the RC3.5
 * error-strategy vocabulary through RC4.0.
 */
export type ExtractionErrorStrategy = ProjectIntegrationErrorStrategy;

/** How a failed attempt would be retried. Reuses the RC3.2 retry shape. */
export type ExtractionRetryPolicy = SyncRetryPolicy;

/**
 * The full behavioural contract for an extraction definition.
 *
 * Reuses the RC4.0 {@link ProjectIntegrationPolicy} shape verbatim:
 * `dryRunOnly` defaults to the safe posture the repository uses everywhere —
 * describe and validate, never write, until a write path is explicitly
 * approved.
 */
export type ExtractionPolicy = ProjectIntegrationPolicy;

// Reuse the RC4.0 conservative default (sequential, abort on first failure,
// never retry, dry-run only) under an extraction-facing name — one safe
// default posture across the whole system, never a local variant.
export { defaultProjectIntegrationPolicy as defaultExtractionPolicy } from "@/features/forever-project-integration";
