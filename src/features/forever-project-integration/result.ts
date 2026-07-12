/**
 * Forever Project Integration — result and issue constructors.
 *
 * Pure, deterministic helpers for assembling {@link ProjectIntegrationResult}
 * values and the issues they carry. Centralised so stages, steps, and validation
 * all build results the same way and the stats/state/outcome triple stays
 * internally consistent — a result can never claim a state its counters
 * contradict.
 *
 * Mirrors the RC3.1/RC3.2/RC3.5 result constructors so all the foundations
 * report the same way.
 */

import { deriveProjectIntegrationOutcome, deriveProjectIntegrationState } from "./derive";
import type {
  ProjectIntegrationError,
  ProjectIntegrationIssue,
  ProjectIntegrationResult,
  ProjectIntegrationRunMetadata,
  ProjectIntegrationStats,
  ProjectIntegrationWarning,
} from "./types";

/** Build a blocking error issue. */
export function projectIntegrationError(
  code: string,
  message: string,
  path?: string,
): ProjectIntegrationError {
  return path === undefined
    ? { code, message, severity: "error" }
    : { code, message, path, severity: "error" };
}

/** Build a non-blocking warning issue. */
export function projectIntegrationWarning(
  code: string,
  message: string,
  path?: string,
): ProjectIntegrationWarning {
  return path === undefined
    ? { code, message, severity: "warning" }
    : { code, message, path, severity: "warning" };
}

/** Split a mixed issue list into its error and warning halves, order-preserving. */
export function partitionProjectIntegrationIssues(
  issues: readonly ProjectIntegrationIssue[],
): {
  errors: ProjectIntegrationError[];
  warnings: ProjectIntegrationWarning[];
} {
  const errors: ProjectIntegrationError[] = [];
  const warnings: ProjectIntegrationWarning[] = [];
  for (const issue of issues) {
    if (issue.severity === "error") errors.push(issue as ProjectIntegrationError);
    else warnings.push(issue as ProjectIntegrationWarning);
  }
  return { errors, warnings };
}

/** A zeroed {@link ProjectIntegrationStats}. */
export function emptyProjectIntegrationStats(): ProjectIntegrationStats {
  return { stages: 0, steps: 0, completed: 0, skipped: 0, failed: 0, warnings: 0, errors: 0 };
}

/**
 * Assemble a {@link ProjectIntegrationResult} from planned records and raised
 * issues.
 *
 * `ok`, `state`, and `outcome` are all derived — the error/warning counts on
 * `stats` are recomputed from the issues, and `state`/`outcome` follow from the
 * reconciled stats — so the four can never drift apart.
 */
export function createProjectIntegrationResult<T>(args: {
  data: T[];
  issues?: readonly ProjectIntegrationIssue[];
  stats: ProjectIntegrationStats;
  metadata: ProjectIntegrationRunMetadata;
}): ProjectIntegrationResult<T> {
  const { errors, warnings } = partitionProjectIntegrationIssues(args.issues ?? []);
  const stats: ProjectIntegrationStats = {
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
