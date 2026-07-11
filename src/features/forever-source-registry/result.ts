/**
 * Forever Source Registry — issue constructors.
 *
 * Pure, deterministic helpers for building the {@link SourceIssue} values the
 * validation pipeline returns. Centralised so every validator raises issues the
 * same way and the error/warning split stays consistent across the module.
 */

import type { SourceError, SourceIssue, SourceWarning } from "./types";

/** Build a blocking error issue. */
export function sourceError(code: string, message: string, path?: string): SourceError {
  return path === undefined
    ? { code, message, severity: "error" }
    : { code, message, path, severity: "error" };
}

/** Build a non-blocking warning issue. */
export function sourceWarning(code: string, message: string, path?: string): SourceWarning {
  return path === undefined
    ? { code, message, severity: "warning" }
    : { code, message, path, severity: "warning" };
}

/** Split a mixed issue list into its error and warning halves, order-preserving. */
export function partitionSourceIssues(issues: readonly SourceIssue[]): {
  errors: SourceError[];
  warnings: SourceWarning[];
} {
  const errors: SourceError[] = [];
  const warnings: SourceWarning[] = [];
  for (const issue of issues) {
    if (issue.severity === "error") errors.push(issue as SourceError);
    else warnings.push(issue as SourceWarning);
  }
  return { errors, warnings };
}
