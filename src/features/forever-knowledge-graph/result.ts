/**
 * Forever Knowledge Graph — result models and constructors.
 *
 * A {@link KnowledgeGraphResult} is the deterministic report of describing
 * one knowledge graph: the described graph it would carry forward, the
 * issues raised, the counters of what the description covers, and
 * provenance. The lifecycle state, coarse outcome, stats shape, and
 * derivation rules are the RC4.0 ones — reused through the RC4.6 re-exports,
 * the very same functions — so a described graph settles by exactly the rule
 * an integration run, a factory build, a planned extraction, a described
 * canonical merge, or a described cross-source examination does, and `ok`,
 * `state`, `outcome`, and the counters can never drift apart across
 * foundations.
 *
 * {@link createKnowledgeGraphResult} is centralised so the description
 * engine and validation build results the same way: the error/warning counts
 * are recomputed from the issues, and `state`/`outcome` follow from the
 * reconciled stats. RC4.8 runs nothing — a result describes what a graph
 * *would* represent, never a run itself.
 */

import type { ISODateTime } from "@/features/forever-database";
import {
  deriveProjectDatabaseOutcome,
  deriveProjectDatabaseState,
  type ProjectDatabaseOutcome,
  type ProjectDatabaseState,
  type ProjectDatabaseStats,
} from "@/features/forever-project-database";

import { partitionKnowledgeIssues } from "./types";
import type { KnowledgeError, KnowledgeIssue, KnowledgeWarning } from "./types";

/**
 * The lifecycle state of a described graph. Reuses the RC4.0 vocabulary
 * (through the RC4.6 re-export) so a knowledge graph reports exactly the way
 * an integration run does.
 */
export type KnowledgeGraphState = ProjectDatabaseState;

/** The coarse outcome of a described graph. Reuses RC4.0 through RC4.6. */
export type KnowledgeGraphOutcome = ProjectDatabaseOutcome;

/**
 * Deterministic counters describing what a description would touch. Reuses
 * the RC4.0 stats shape (through the RC4.6 re-export) so knowledge-graph
 * counters merge, sum, and derive identically.
 */
export type KnowledgeGraphStats = ProjectDatabaseStats;

// Reuse the RC4.0 state/outcome vocabularies, guards, and derivation rules
// (through the RC4.6 re-exports — the very same functions) under
// knowledge-graph names — one lifecycle across the whole system, never a
// local variant, and nothing to drift out of sync.
export {
  PROJECT_DATABASE_STATES as KNOWLEDGE_GRAPH_STATES,
  PROJECT_DATABASE_TERMINAL_STATES as KNOWLEDGE_GRAPH_TERMINAL_STATES,
  isTerminalProjectDatabaseState as isTerminalKnowledgeGraphState,
  isKnownProjectDatabaseState as isKnownKnowledgeGraphState,
  isSuccessfulProjectDatabaseOutcome as isSuccessfulKnowledgeGraphOutcome,
  deriveProjectDatabaseState as deriveKnowledgeGraphState,
  deriveProjectDatabaseOutcome as deriveKnowledgeGraphOutcome,
  emptyProjectDatabaseStats as emptyKnowledgeGraphStats,
} from "@/features/forever-project-database";

/**
 * Provenance attached to the output of one described graph.
 *
 * The counters mirror the description so a caller can read the headline
 * facts without re-deriving them. `describedAt` is set from
 * {@link import("./context").KnowledgeGraphContext.now} when present; the
 * foundation reads no wall clock. The graph and project references are
 * attached only when the description resolved them (anti-fabrication).
 */
export interface KnowledgeGraphRunMetadata {
  /** The described graph, when one was described. */
  graphId?: string;
  /** The project the graph belongs to, when one was resolved. */
  projectId?: string;
  /** Deterministic timestamp for provenance; supplied by the caller. */
  describedAt?: ISODateTime;
  /** Nodes the description would represent. */
  nodeCount: number;
  /** Edges the description would represent. */
  edgeCount: number;
  /** Incoming RC4.5 facts the description considered. */
  factCount: number;
  /** Registered RC4.4 sources the description consulted. */
  sourceCount: number;
  /** Claims (distinct readings of subjects) the description represents. */
  claimCount: number;
  /** Elements whose standing marks an unresolved disagreement for review. */
  unresolvedCount: number;
}

/**
 * The result of describing one knowledge graph.
 *
 * Generic over the described value the description would carry forward. `ok`
 * is `true` only when no blocking {@link KnowledgeError} was raised; `state`
 * and `outcome` are derived deterministically from the stats so they can
 * never disagree with the counters.
 */
export interface KnowledgeGraphResult<T> {
  ok: boolean;
  state: KnowledgeGraphState;
  outcome: KnowledgeGraphOutcome;
  data: T[];
  errors: KnowledgeError[];
  warnings: KnowledgeWarning[];
  stats: KnowledgeGraphStats;
  metadata: KnowledgeGraphRunMetadata;
}

/**
 * Assemble a {@link KnowledgeGraphResult} from described data and raised
 * issues.
 *
 * `ok`, `state`, and `outcome` are all derived — the error/warning counts on
 * `stats` are recomputed from the issues, and `state`/`outcome` follow from
 * the reconciled stats through the reused RC4.0 rules — so the four can
 * never drift apart.
 */
export function createKnowledgeGraphResult<T>(args: {
  data: T[];
  issues?: readonly KnowledgeIssue[];
  stats: KnowledgeGraphStats;
  metadata: KnowledgeGraphRunMetadata;
}): KnowledgeGraphResult<T> {
  const { errors, warnings } = partitionKnowledgeIssues(args.issues ?? []);
  const stats: KnowledgeGraphStats = {
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
