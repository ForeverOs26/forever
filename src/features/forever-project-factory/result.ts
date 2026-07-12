/**
 * Forever Project Factory — result models and constructors.
 *
 * A {@link FactoryResult} is the deterministic report of planning one build:
 * the described data it would carry forward, the issues raised, the counters of
 * what the plan covers, and provenance. The lifecycle state, coarse outcome,
 * stats shape, and derivation rules are the RC4.0 ones, reused wholesale rather
 * than restated — a factory build settles by exactly the rule an integration
 * run does, so `ok`, `state`, `outcome`, and the counters can never drift apart
 * across foundations.
 *
 * {@link createFactoryResult} is centralised so planning and validation build
 * results the same way: the error/warning counts are recomputed from the
 * issues, and `state`/`outcome` follow from the reconciled stats. RC4.3 runs
 * nothing — a result describes what a build *would* settle into, never a run
 * itself.
 */

import type { ISODateTime, Slug } from "@/features/forever-database";
import {
  deriveProjectIntegrationOutcome,
  deriveProjectIntegrationState,
  type ProjectIntegrationOutcome,
  type ProjectIntegrationState,
  type ProjectIntegrationStats,
} from "@/features/forever-project-integration";

import { partitionFactoryIssues } from "./types";
import type { FactoryError, FactoryId, FactoryIssue, FactoryWarning } from "./types";

/**
 * The lifecycle state of a planned build. Reuses the RC4.0 vocabulary so a
 * factory build reports exactly the way an integration run does.
 */
export type FactoryState = ProjectIntegrationState;

/** The coarse outcome of a planned build. Reuses the RC4.0 vocabulary. */
export type FactoryOutcome = ProjectIntegrationOutcome;

/**
 * Deterministic counters describing what a planned build would touch. Reuses
 * the RC4.0 stats shape so factory counters merge, sum, and derive identically.
 */
export type FactoryStats = ProjectIntegrationStats;

// Reuse the RC4.0 state/outcome vocabularies, guards, and derivation rules
// under factory-facing names — one lifecycle across the whole system, never a
// local variant, and nothing to drift out of sync.
export {
  PROJECT_INTEGRATION_STATES as FACTORY_STATES,
  PROJECT_INTEGRATION_TERMINAL_STATES as FACTORY_TERMINAL_STATES,
  isTerminalProjectIntegrationState as isTerminalFactoryState,
  isKnownProjectIntegrationState as isKnownFactoryState,
  isSuccessfulProjectIntegrationOutcome as isSuccessfulFactoryOutcome,
  deriveProjectIntegrationState as deriveFactoryState,
  deriveProjectIntegrationOutcome as deriveFactoryOutcome,
  emptyProjectIntegrationStats as emptyFactoryStats,
} from "@/features/forever-project-integration";

/**
 * Provenance attached to the output of one planned build.
 *
 * `stageCount`/`stepCount`/`entityCount` mirror the recipe and the described
 * package so a caller can read the headline facts without re-deriving them.
 * `plannedAt` is set from {@link import("./context").FactoryContext.now} when
 * present; the foundation reads no wall clock. `recipeId` and `projectSlug`
 * are attached only when the plan resolved them (anti-fabrication).
 */
export interface FactoryBuildMetadata {
  factoryId: FactoryId;
  /** The recipe the planned build follows. */
  recipeId?: string;
  /** The verified project slug the build was planned for, normalized. */
  projectSlug?: Slug;
  /** Deterministic timestamp for provenance; supplied by the caller. */
  plannedAt?: ISODateTime;
  stageCount: number;
  stepCount: number;
  entityCount: number;
}

/**
 * The result of planning one factory build.
 *
 * Generic over the described value the plan would carry forward. `ok` is `true`
 * only when no blocking {@link FactoryError} was raised; `state` and `outcome`
 * are derived deterministically from the stats so they can never disagree with
 * the counters.
 */
export interface FactoryResult<T> {
  ok: boolean;
  state: FactoryState;
  outcome: FactoryOutcome;
  data: T[];
  errors: FactoryError[];
  warnings: FactoryWarning[];
  stats: FactoryStats;
  metadata: FactoryBuildMetadata;
}

/**
 * Assemble a {@link FactoryResult} from described records and raised issues.
 *
 * `ok`, `state`, and `outcome` are all derived — the error/warning counts on
 * `stats` are recomputed from the issues, and `state`/`outcome` follow from the
 * reconciled stats through the reused RC4.0 rules — so the four can never drift
 * apart.
 */
export function createFactoryResult<T>(args: {
  data: T[];
  issues?: readonly FactoryIssue[];
  stats: FactoryStats;
  metadata: FactoryBuildMetadata;
}): FactoryResult<T> {
  const { errors, warnings } = partitionFactoryIssues(args.issues ?? []);
  const stats: FactoryStats = {
    ...args.stats,
    errors: errors.length,
    warnings: warnings.length,
  };
  return {
    ok: errors.length === 0,
    state: deriveProjectIntegrationState(stats),
    outcome: deriveProjectIntegrationOutcome(stats),
    data: args.data,
    errors,
    warnings,
    stats,
    metadata: args.metadata,
  };
}
