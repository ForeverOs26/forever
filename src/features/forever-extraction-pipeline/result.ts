/**
 * Forever Extraction Pipeline — result models and constructors.
 *
 * An {@link ExtractionResult} is the deterministic report of planning one
 * extraction: the described data it would carry forward, the issues raised,
 * the counters of what the plan covers, and provenance. The lifecycle state,
 * coarse outcome, stats shape, and derivation rules are the RC4.0 ones,
 * reused wholesale rather than restated — a planned extraction settles by
 * exactly the rule an integration run or a factory build does, so `ok`,
 * `state`, `outcome`, and the counters can never drift apart across
 * foundations.
 *
 * {@link createExtractionResult} is centralised so planning and validation
 * build results the same way: the error/warning counts are recomputed from
 * the issues, and `state`/`outcome` follow from the reconciled stats. RC4.5
 * runs nothing — a result describes what an extraction *would* settle into,
 * never a run itself.
 */

import type { ISODateTime } from "@/features/forever-database";
import {
  deriveProjectIntegrationOutcome,
  deriveProjectIntegrationState,
  type ProjectIntegrationOutcome,
  type ProjectIntegrationState,
  type ProjectIntegrationStats,
} from "@/features/forever-project-integration";
import type { ProjectSourceId } from "@/features/forever-project-sources";

import { partitionExtractionIssues } from "./types";
import type { ExtractionError, ExtractionId, ExtractionIssue, ExtractionWarning } from "./types";
import type { ExtractionSourceVersion } from "./version";

/**
 * The lifecycle state of a planned extraction. Reuses the RC4.0 vocabulary so
 * an extraction reports exactly the way an integration run does.
 */
export type ExtractionState = ProjectIntegrationState;

/** The coarse outcome of a planned extraction. Reuses the RC4.0 vocabulary. */
export type ExtractionOutcome = ProjectIntegrationOutcome;

/**
 * Deterministic counters describing what a planned extraction would touch.
 * Reuses the RC4.0 stats shape so extraction counters merge, sum, and derive
 * identically.
 */
export type ExtractionStats = ProjectIntegrationStats;

// Reuse the RC4.0 state/outcome vocabularies, guards, and derivation rules
// under extraction-facing names — one lifecycle across the whole system,
// never a local variant, and nothing to drift out of sync.
export {
  PROJECT_INTEGRATION_STATES as EXTRACTION_STATES,
  PROJECT_INTEGRATION_TERMINAL_STATES as EXTRACTION_TERMINAL_STATES,
  isTerminalProjectIntegrationState as isTerminalExtractionState,
  isKnownProjectIntegrationState as isKnownExtractionState,
  isSuccessfulProjectIntegrationOutcome as isSuccessfulExtractionOutcome,
  deriveProjectIntegrationState as deriveExtractionState,
  deriveProjectIntegrationOutcome as deriveExtractionOutcome,
  emptyProjectIntegrationStats as emptyExtractionStats,
} from "@/features/forever-project-integration";

/**
 * Provenance attached to the output of one planned extraction.
 *
 * `stageCount`/`stepCount`/`targetCount` mirror the recipe and the described
 * plan so a caller can read the headline facts without re-deriving them.
 * `plannedAt` is set from {@link import("./context").ExtractionContext.now}
 * when present; the foundation reads no wall clock. The recipe, source,
 * project, and revision references are attached only when the plan resolved
 * them (anti-fabrication).
 */
export interface ExtractionRunMetadata {
  definitionId: ExtractionId;
  /** The recipe the planned extraction follows. */
  recipeId?: string;
  /** The RC4.4 catalogued source the extraction was planned over. */
  sourceId?: ProjectSourceId;
  /** The project the planned extraction belongs to. */
  projectId?: string;
  /** The received revision the extraction was planned against. */
  sourceVersion?: ExtractionSourceVersion;
  /** Deterministic timestamp for provenance; supplied by the caller. */
  plannedAt?: ISODateTime;
  stageCount: number;
  stepCount: number;
  targetCount: number;
}

/**
 * The result of planning one extraction.
 *
 * Generic over the described value the plan would carry forward. `ok` is
 * `true` only when no blocking {@link ExtractionError} was raised; `state`
 * and `outcome` are derived deterministically from the stats so they can
 * never disagree with the counters.
 */
export interface ExtractionResult<T> {
  ok: boolean;
  state: ExtractionState;
  outcome: ExtractionOutcome;
  data: T[];
  errors: ExtractionError[];
  warnings: ExtractionWarning[];
  stats: ExtractionStats;
  metadata: ExtractionRunMetadata;
}

/**
 * Assemble an {@link ExtractionResult} from described records and raised
 * issues.
 *
 * `ok`, `state`, and `outcome` are all derived — the error/warning counts on
 * `stats` are recomputed from the issues, and `state`/`outcome` follow from
 * the reconciled stats through the reused RC4.0 rules — so the four can never
 * drift apart.
 */
export function createExtractionResult<T>(args: {
  data: T[];
  issues?: readonly ExtractionIssue[];
  stats: ExtractionStats;
  metadata: ExtractionRunMetadata;
}): ExtractionResult<T> {
  const { errors, warnings } = partitionExtractionIssues(args.issues ?? []);
  const stats: ExtractionStats = {
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
