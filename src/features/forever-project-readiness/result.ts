/**
 * Forever Project Readiness — result models and constructors.
 *
 * A {@link ReadinessResult} is the deterministic report of describing one
 * readiness examination: the described report it would carry forward, the
 * issues raised, the counters of what the examination covers, and
 * provenance. The lifecycle state, coarse outcome, stats shape, and
 * derivation rules are the RC4.0 ones — reused through the RC4.6 re-exports,
 * the very same functions — so a described examination settles by exactly
 * the rule an integration run, a factory build, a planned extraction, a
 * described canonical merge, a described cross-source examination, or a
 * described knowledge graph does, and `ok`, `state`, `outcome`, and the
 * counters can never drift apart across foundations.
 *
 * {@link createReadinessResult} is centralised so the examination engine and
 * validation build results the same way: the error/warning counts are
 * recomputed from the issues, and `state`/`outcome` follow from the
 * reconciled stats. RC4.9 runs nothing — a result describes what an
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

import { partitionReadinessIssues } from "./types";
import type { ReadinessError, ReadinessIssue, ReadinessWarning } from "./types";

/**
 * The lifecycle state of a described examination. Reuses the RC4.0
 * vocabulary (through the RC4.6 re-export) so a readiness examination
 * reports exactly the way an integration run does.
 */
export type ReadinessState = ProjectDatabaseState;

/** The coarse outcome of a described examination. Reuses RC4.0 through RC4.6. */
export type ReadinessOutcome = ProjectDatabaseOutcome;

/**
 * Deterministic counters describing what an examination would touch. Reuses
 * the RC4.0 stats shape (through the RC4.6 re-export) so readiness counters
 * merge, sum, and derive identically.
 */
export type ReadinessStats = ProjectDatabaseStats;

// Reuse the RC4.0 state/outcome vocabularies, guards, and derivation rules
// (through the RC4.6 re-exports — the very same functions) under readiness
// names — one lifecycle across the whole system, never a local variant, and
// nothing to drift out of sync.
export {
  PROJECT_DATABASE_STATES as READINESS_STATES,
  PROJECT_DATABASE_TERMINAL_STATES as READINESS_TERMINAL_STATES,
  isTerminalProjectDatabaseState as isTerminalReadinessState,
  isKnownProjectDatabaseState as isKnownReadinessState,
  isSuccessfulProjectDatabaseOutcome as isSuccessfulReadinessOutcome,
  deriveProjectDatabaseState as deriveReadinessState,
  deriveProjectDatabaseOutcome as deriveReadinessOutcome,
  emptyProjectDatabaseStats as emptyReadinessStats,
} from "@/features/forever-project-database";

/**
 * Provenance attached to the output of one described examination.
 *
 * The counters mirror the examination so a caller can read the headline
 * facts without re-deriving them. `describedAt` is set from
 * {@link import("./context").ReadinessContext.now} when present; the
 * foundation reads no wall clock. The report and project references are
 * attached only when the examination resolved them (anti-fabrication).
 */
export interface ReadinessRunMetadata {
  /** The described report, when one was described. */
  reportId?: string;
  /** The project the examination concerns, when one was resolved. */
  projectId?: string;
  /** Deterministic timestamp for provenance; supplied by the caller. */
  describedAt?: ISODateTime;
  /** Requirement slots the caller stated (admissible and inadmissible alike). */
  requirementCount: number;
  /** Statements the examination judged. */
  evaluationCount: number;
  /** Statements the supplied inputs satisfy. */
  metCount: number;
  /** Statements the supplied inputs leave unsatisfied. */
  unmetCount: number;
  /** Statements no supplied input could judge. */
  indeterminateCount: number;
  /** Required statements standing anything but met — the described blockers. */
  blockerCount: number;
}

/**
 * The result of describing one readiness examination.
 *
 * Generic over the described value the examination would carry forward. `ok`
 * is `true` only when no blocking {@link ReadinessError} was raised; `state`
 * and `outcome` are derived deterministically from the stats so they can
 * never disagree with the counters.
 */
export interface ReadinessResult<T> {
  ok: boolean;
  state: ReadinessState;
  outcome: ReadinessOutcome;
  data: T[];
  errors: ReadinessError[];
  warnings: ReadinessWarning[];
  stats: ReadinessStats;
  metadata: ReadinessRunMetadata;
}

/**
 * Assemble a {@link ReadinessResult} from described data and raised issues.
 *
 * `ok`, `state`, and `outcome` are all derived — the error/warning counts on
 * `stats` are recomputed from the issues, and `state`/`outcome` follow from
 * the reconciled stats through the reused RC4.0 rules — so the four can
 * never drift apart.
 */
export function createReadinessResult<T>(args: {
  data: T[];
  issues?: readonly ReadinessIssue[];
  stats: ReadinessStats;
  metadata: ReadinessRunMetadata;
}): ReadinessResult<T> {
  const { errors, warnings } = partitionReadinessIssues(args.issues ?? []);
  const stats: ReadinessStats = {
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
