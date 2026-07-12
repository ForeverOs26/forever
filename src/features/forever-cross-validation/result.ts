/**
 * Forever Cross-Source Validation — result models and constructors.
 *
 * A {@link CrossValidationResult} is the deterministic report of describing
 * one cross-source examination: the described data it would carry forward,
 * the issues raised, the counters of what the description covers, and
 * provenance. The lifecycle state, coarse outcome, stats shape, and
 * derivation rules are the RC4.0 ones — reused through the RC4.6 re-exports,
 * the very same functions — so a described examination settles by exactly the
 * rule an integration run, a factory build, a planned extraction, or a
 * described canonical merge does, and `ok`, `state`, `outcome`, and the
 * counters can never drift apart across foundations.
 *
 * {@link createCrossValidationResult} is centralised so the examination
 * engine and validation build results the same way: the error/warning counts
 * are recomputed from the issues, and `state`/`outcome` follow from the
 * reconciled stats. RC4.7 runs nothing — a result describes what an
 * examination *would* conclude, never a run itself.
 */

import type { ISODateTime } from "@/features/forever-database";
import {
  deriveProjectDatabaseOutcome,
  deriveProjectDatabaseState,
  type ProjectDatabaseOutcome,
  type ProjectDatabaseState,
  type ProjectDatabaseStats,
} from "@/features/forever-project-database";

import { partitionCrossValidationIssues } from "./types";
import type { CrossValidationError, CrossValidationIssue, CrossValidationWarning } from "./types";

/**
 * The lifecycle state of a described examination. Reuses the RC4.0 vocabulary
 * (through the RC4.6 re-export) so cross-validation reports exactly the way
 * an integration run does.
 */
export type CrossValidationState = ProjectDatabaseState;

/** The coarse outcome of a described examination. Reuses RC4.0 through RC4.6. */
export type CrossValidationOutcome = ProjectDatabaseOutcome;

/**
 * Deterministic counters describing what an examination would touch. Reuses
 * the RC4.0 stats shape (through the RC4.6 re-export) so cross-validation
 * counters merge, sum, and derive identically.
 */
export type CrossValidationStats = ProjectDatabaseStats;

// Reuse the RC4.0 state/outcome vocabularies, guards, and derivation rules
// (through the RC4.6 re-exports — the very same functions) under
// cross-validation names — one lifecycle across the whole system, never a
// local variant, and nothing to drift out of sync.
export {
  PROJECT_DATABASE_STATES as CROSS_VALIDATION_STATES,
  PROJECT_DATABASE_TERMINAL_STATES as CROSS_VALIDATION_TERMINAL_STATES,
  isTerminalProjectDatabaseState as isTerminalCrossValidationState,
  isKnownProjectDatabaseState as isKnownCrossValidationState,
  isSuccessfulProjectDatabaseOutcome as isSuccessfulCrossValidationOutcome,
  deriveProjectDatabaseState as deriveCrossValidationState,
  deriveProjectDatabaseOutcome as deriveCrossValidationOutcome,
  emptyProjectDatabaseStats as emptyCrossValidationStats,
} from "@/features/forever-project-database";

/**
 * Provenance attached to the output of one described examination.
 *
 * The counters mirror the description so a caller can read the headline
 * facts without re-deriving them. `describedAt` is set from
 * {@link import("./context").CrossValidationContext.now} when present; the
 * foundation reads no wall clock. The report and project references are
 * attached only when the description resolved them (anti-fabrication).
 */
export interface CrossValidationRunMetadata {
  /** The described report, when one was described. */
  reportId?: string;
  /** The project the examination belongs to, when one was resolved. */
  projectId?: string;
  /** Deterministic timestamp for provenance; supplied by the caller. */
  describedAt?: ISODateTime;
  /** Incoming extracted facts the examination considered. */
  factCount: number;
  /** Registered RC4.4 sources the examination consulted. */
  sourceCount: number;
  /** Subjects the examination assessed. */
  subjectCount: number;
  /** Findings the examination described. */
  findingCount: number;
  /** Findings requiring future human review — described, never resolved. */
  reviewCount: number;
}

/**
 * The result of describing one cross-source examination.
 *
 * Generic over the described value the examination would carry forward. `ok`
 * is `true` only when no blocking {@link CrossValidationError} was raised;
 * `state` and `outcome` are derived deterministically from the stats so they
 * can never disagree with the counters.
 */
export interface CrossValidationResult<T> {
  ok: boolean;
  state: CrossValidationState;
  outcome: CrossValidationOutcome;
  data: T[];
  errors: CrossValidationError[];
  warnings: CrossValidationWarning[];
  stats: CrossValidationStats;
  metadata: CrossValidationRunMetadata;
}

/**
 * Assemble a {@link CrossValidationResult} from described data and raised
 * issues.
 *
 * `ok`, `state`, and `outcome` are all derived — the error/warning counts on
 * `stats` are recomputed from the issues, and `state`/`outcome` follow from
 * the reconciled stats through the reused RC4.0 rules — so the four can never
 * drift apart.
 */
export function createCrossValidationResult<T>(args: {
  data: T[];
  issues?: readonly CrossValidationIssue[];
  stats: CrossValidationStats;
  metadata: CrossValidationRunMetadata;
}): CrossValidationResult<T> {
  const { errors, warnings } = partitionCrossValidationIssues(args.issues ?? []);
  const stats: CrossValidationStats = {
    ...args.stats,
    errors: errors.length,
    warnings: warnings.length,
  };
  return {
    ok: errors.length === 0,
    state: deriveProjectDatabaseState(stats),
    outcome: deriveProjectDatabaseOutcome(stats),
    data: args.data,
    errors,
    warnings,
    stats,
    metadata: args.metadata,
  };
}
