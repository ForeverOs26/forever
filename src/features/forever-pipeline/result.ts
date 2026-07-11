/**
 * Forever Pipeline — result and issue constructors.
 *
 * Pure, deterministic helpers for assembling {@link PipelineResult} values and
 * the issues they carry. Centralised so stages, steps, and validation all build
 * results the same way and the stats/state/outcome triple stays internally
 * consistent — a result can never claim a state its counters contradict.
 *
 * Mirrors the RC3.1/RC3.2 result constructors so all the foundations report the
 * same way.
 */

import { derivePipelineOutcome, derivePipelineState } from "./derive";
import type {
  PipelineError,
  PipelineIssue,
  PipelineResult,
  PipelineRunMetadata,
  PipelineStats,
  PipelineWarning,
} from "./types";

/** Build a blocking error issue. */
export function pipelineError(code: string, message: string, path?: string): PipelineError {
  return path === undefined
    ? { code, message, severity: "error" }
    : { code, message, path, severity: "error" };
}

/** Build a non-blocking warning issue. */
export function pipelineWarning(code: string, message: string, path?: string): PipelineWarning {
  return path === undefined
    ? { code, message, severity: "warning" }
    : { code, message, path, severity: "warning" };
}

/** Split a mixed issue list into its error and warning halves, order-preserving. */
export function partitionPipelineIssues(issues: readonly PipelineIssue[]): {
  errors: PipelineError[];
  warnings: PipelineWarning[];
} {
  const errors: PipelineError[] = [];
  const warnings: PipelineWarning[] = [];
  for (const issue of issues) {
    if (issue.severity === "error") errors.push(issue as PipelineError);
    else warnings.push(issue as PipelineWarning);
  }
  return { errors, warnings };
}

/** A zeroed {@link PipelineStats}. */
export function emptyPipelineStats(): PipelineStats {
  return { stages: 0, steps: 0, completed: 0, skipped: 0, failed: 0, warnings: 0, errors: 0 };
}

/**
 * Assemble a {@link PipelineResult} from planned records and raised issues.
 *
 * `ok`, `state`, and `outcome` are all derived — the error/warning counts on
 * `stats` are recomputed from the issues, and `state`/`outcome` follow from the
 * reconciled stats — so the four can never drift apart.
 */
export function createPipelineResult<T>(args: {
  data: T[];
  issues?: readonly PipelineIssue[];
  stats: PipelineStats;
  metadata: PipelineRunMetadata;
}): PipelineResult<T> {
  const { errors, warnings } = partitionPipelineIssues(args.issues ?? []);
  const stats: PipelineStats = {
    ...args.stats,
    errors: errors.length,
    warnings: warnings.length,
  };
  return {
    ok: errors.length === 0,
    state: derivePipelineState(stats),
    outcome: derivePipelineOutcome(stats),
    data: args.data,
    errors,
    warnings,
    stats,
    metadata: args.metadata,
  };
}
