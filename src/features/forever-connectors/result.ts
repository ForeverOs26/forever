/**
 * Forever Connectors — issue constructors.
 *
 * Pure, deterministic helpers for building the {@link ConnectorIssue} values the
 * validation pipeline returns. Centralised so every validator raises issues the
 * same way and the error/warning split stays consistent across the module —
 * mirroring the RC3.1/RC3.2/RC3.3 issue constructors so all four foundations
 * report the same way.
 */

import type { ConnectorError, ConnectorIssue, ConnectorWarning } from "./types";

/** Build a blocking error issue. */
export function connectorError(code: string, message: string, path?: string): ConnectorError {
  return path === undefined
    ? { code, message, severity: "error" }
    : { code, message, path, severity: "error" };
}

/** Build a non-blocking warning issue. */
export function connectorWarning(
  code: string,
  message: string,
  path?: string,
): ConnectorWarning {
  return path === undefined
    ? { code, message, severity: "warning" }
    : { code, message, path, severity: "warning" };
}

/** Split a mixed issue list into its error and warning halves, order-preserving. */
export function partitionConnectorIssues(issues: readonly ConnectorIssue[]): {
  errors: ConnectorError[];
  warnings: ConnectorWarning[];
} {
  const errors: ConnectorError[] = [];
  const warnings: ConnectorWarning[] = [];
  for (const issue of issues) {
    if (issue.severity === "error") errors.push(issue as ConnectorError);
    else warnings.push(issue as ConnectorWarning);
  }
  return { errors, warnings };
}
