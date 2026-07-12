/**
 * Forever Canonical Project Database — result models and constructors.
 *
 * A {@link ProjectResult} is the deterministic report of describing one
 * canonical operation: the described data it would carry forward, the issues
 * raised, the counters of what the description covers, and provenance. The
 * lifecycle state, coarse outcome, stats shape, and derivation rules are the
 * RC4.0 ones, reused wholesale rather than restated — a described merge
 * settles by exactly the rule an integration run, a factory build, or a
 * planned extraction does, so `ok`, `state`, `outcome`, and the counters can
 * never drift apart across foundations.
 *
 * {@link createProjectResult} is centralised so merge description and
 * validation build results the same way: the error/warning counts are
 * recomputed from the issues, and `state`/`outcome` follow from the
 * reconciled stats. RC4.6 runs nothing — a result describes what an
 * operation *would* settle into, never a run itself.
 */

import type { ISODateTime } from "@/features/forever-database";
import {
  deriveProjectIntegrationOutcome,
  deriveProjectIntegrationState,
  type ProjectIntegrationOutcome,
  type ProjectIntegrationState,
  type ProjectIntegrationStats,
} from "@/features/forever-project-integration";

import { partitionProjectDatabaseIssues } from "./types";
import type {
  ProjectDatabaseError,
  ProjectDatabaseIssue,
  ProjectDatabaseWarning,
  ProjectRecordId,
} from "./types";

/**
 * The lifecycle state of a described canonical operation. Reuses the RC4.0
 * vocabulary so the database reports exactly the way an integration run does.
 */
export type ProjectDatabaseState = ProjectIntegrationState;

/** The coarse outcome of a described canonical operation. Reuses RC4.0. */
export type ProjectDatabaseOutcome = ProjectIntegrationOutcome;

/**
 * Deterministic counters describing what a canonical description would touch.
 * Reuses the RC4.0 stats shape so database counters merge, sum, and derive
 * identically.
 */
export type ProjectDatabaseStats = ProjectIntegrationStats;

// Reuse the RC4.0 state/outcome vocabularies, guards, and derivation rules
// under canonical-database names — one lifecycle across the whole system,
// never a local variant, and nothing to drift out of sync.
export {
  PROJECT_INTEGRATION_STATES as PROJECT_DATABASE_STATES,
  PROJECT_INTEGRATION_TERMINAL_STATES as PROJECT_DATABASE_TERMINAL_STATES,
  isTerminalProjectIntegrationState as isTerminalProjectDatabaseState,
  isKnownProjectIntegrationState as isKnownProjectDatabaseState,
  isSuccessfulProjectIntegrationOutcome as isSuccessfulProjectDatabaseOutcome,
  deriveProjectIntegrationState as deriveProjectDatabaseState,
  deriveProjectIntegrationOutcome as deriveProjectDatabaseOutcome,
  emptyProjectIntegrationStats as emptyProjectDatabaseStats,
} from "@/features/forever-project-integration";

/**
 * Provenance attached to the output of one described canonical operation.
 *
 * `fieldCount`/`factCount`/`conflictCount` mirror the description so a caller
 * can read the headline facts without re-deriving them. `describedAt` is set
 * from {@link import("./context").ProjectContext.now} when present; the
 * foundation reads no wall clock. The record, project, revision, and merge
 * references are attached only when the description resolved them
 * (anti-fabrication).
 */
export interface ProjectRunMetadata {
  /** The canonical record the description addressed, when one was resolved. */
  recordId?: ProjectRecordId;
  /** The project the description belongs to, when one was resolved. */
  projectId?: string;
  /** The described revision, when one was described. */
  revisionId?: string;
  /** The described merge, when one was described. */
  mergeId?: string;
  /** Deterministic timestamp for provenance; supplied by the caller. */
  describedAt?: ISODateTime;
  /** Canonical fields the description covers. */
  fieldCount: number;
  /** Incoming extracted facts the description considered. */
  factCount: number;
  /** Conflicts the description recorded — described, never resolved. */
  conflictCount: number;
}

/**
 * The result of describing one canonical operation.
 *
 * Generic over the described value the operation would carry forward. `ok` is
 * `true` only when no blocking {@link ProjectDatabaseError} was raised;
 * `state` and `outcome` are derived deterministically from the stats so they
 * can never disagree with the counters.
 */
export interface ProjectResult<T> {
  ok: boolean;
  state: ProjectDatabaseState;
  outcome: ProjectDatabaseOutcome;
  data: T[];
  errors: ProjectDatabaseError[];
  warnings: ProjectDatabaseWarning[];
  stats: ProjectDatabaseStats;
  metadata: ProjectRunMetadata;
}

/**
 * Assemble a {@link ProjectResult} from described records and raised issues.
 *
 * `ok`, `state`, and `outcome` are all derived — the error/warning counts on
 * `stats` are recomputed from the issues, and `state`/`outcome` follow from
 * the reconciled stats through the reused RC4.0 rules — so the four can never
 * drift apart.
 */
export function createProjectResult<T>(args: {
  data: T[];
  issues?: readonly ProjectDatabaseIssue[];
  stats: ProjectDatabaseStats;
  metadata: ProjectRunMetadata;
}): ProjectResult<T> {
  const { errors, warnings } = partitionProjectDatabaseIssues(args.issues ?? []);
  const stats: ProjectDatabaseStats = {
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
