/**
 * Forever Sync — result and issue constructors.
 *
 * Pure, deterministic helpers for assembling {@link SyncResult} values and the
 * issues they carry. Centralised so connectors, jobs, and validation all build
 * results the same way and the stats/status/outcome triple stays internally
 * consistent — a result can never claim a status its counters contradict.
 */

import { deriveSyncOutcome, deriveSyncStatus } from "./derive";
import type {
  SyncError,
  SyncIssue,
  SyncMetadata,
  SyncResult,
  SyncStats,
  SyncWarning,
} from "./types";

/** Build a blocking error issue. */
export function syncError(code: string, message: string, path?: string): SyncError {
  return path === undefined
    ? { code, message, severity: "error" }
    : { code, message, path, severity: "error" };
}

/** Build a non-blocking warning issue. */
export function syncWarning(code: string, message: string, path?: string): SyncWarning {
  return path === undefined
    ? { code, message, severity: "warning" }
    : { code, message, path, severity: "warning" };
}

/** Split a mixed issue list into its error and warning halves, order-preserving. */
export function partitionSyncIssues(issues: readonly SyncIssue[]): {
  errors: SyncError[];
  warnings: SyncWarning[];
} {
  const errors: SyncError[] = [];
  const warnings: SyncWarning[] = [];
  for (const issue of issues) {
    if (issue.severity === "error") errors.push(issue as SyncError);
    else warnings.push(issue as SyncWarning);
  }
  return { errors, warnings };
}

/** A zeroed {@link SyncStats}. */
export function emptySyncStats(): SyncStats {
  return { total: 0, synced: 0, skipped: 0, failed: 0, conflicts: 0, warnings: 0, errors: 0 };
}

/**
 * Assemble a {@link SyncResult} from planned records and raised issues.
 *
 * `ok`, `status`, and `outcome` are all derived — the error/warning counts on
 * `stats` are recomputed from the issues, and `status`/`outcome` follow from
 * the reconciled stats — so the four can never drift apart.
 */
export function createSyncResult<T>(args: {
  data: T[];
  issues?: readonly SyncIssue[];
  stats: SyncStats;
  metadata: SyncMetadata;
}): SyncResult<T> {
  const { errors, warnings } = partitionSyncIssues(args.issues ?? []);
  const stats: SyncStats = {
    ...args.stats,
    errors: errors.length,
    warnings: warnings.length,
  };
  return {
    ok: errors.length === 0,
    status: deriveSyncStatus(stats),
    outcome: deriveSyncOutcome(stats),
    data: args.data,
    errors,
    warnings,
    stats,
    metadata: args.metadata,
  };
}
