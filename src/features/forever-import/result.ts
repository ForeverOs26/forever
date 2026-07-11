/**
 * Forever Import — result and issue constructors.
 *
 * Pure, deterministic helpers for assembling {@link ImportResult} values and
 * the issues they carry. Centralised so adapters, sources, and validation all
 * build results the same way and stats stay internally consistent.
 */

import type {
  ImportError,
  ImportIssue,
  ImportMetadata,
  ImportResult,
  ImportStats,
  ImportWarning,
} from "./types";

/** Build a blocking error issue. */
export function importError(code: string, message: string, path?: string): ImportError {
  return path === undefined
    ? { code, message, severity: "error" }
    : { code, message, path, severity: "error" };
}

/** Build a non-blocking warning issue. */
export function importWarning(code: string, message: string, path?: string): ImportWarning {
  return path === undefined
    ? { code, message, severity: "warning" }
    : { code, message, path, severity: "warning" };
}

/** Split a mixed issue list into its error and warning halves, order-preserving. */
export function partitionIssues(issues: readonly ImportIssue[]): {
  errors: ImportError[];
  warnings: ImportWarning[];
} {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  for (const issue of issues) {
    if (issue.severity === "error") errors.push(issue as ImportError);
    else warnings.push(issue as ImportWarning);
  }
  return { errors, warnings };
}

/** A zeroed {@link ImportStats}. */
export function emptyStats(): ImportStats {
  return { total: 0, imported: 0, skipped: 0, failed: 0, warnings: 0, errors: 0 };
}

/**
 * Assemble an {@link ImportResult} from produced records and raised issues.
 *
 * `ok` is derived from the presence of blocking errors, and the error/warning
 * counts on `stats` are recomputed from the issues so they can never drift.
 */
export function createImportResult<T>(args: {
  data: T[];
  issues?: readonly ImportIssue[];
  stats: ImportStats;
  metadata: ImportMetadata;
}): ImportResult<T> {
  const { errors, warnings } = partitionIssues(args.issues ?? []);
  const stats: ImportStats = {
    ...args.stats,
    errors: errors.length,
    warnings: warnings.length,
  };
  return {
    ok: errors.length === 0,
    data: args.data,
    errors,
    warnings,
    stats,
    metadata: args.metadata,
  };
}
