/**
 * Forever Connectors — version validation.
 *
 * Guards that a {@link ConnectorVersion} carries non-negative integer
 * components. The optional `label` is free text and never validated for shape.
 * All checks return issues; none throw.
 */

import { connectorError } from "../result";
import type { ConnectorIssue } from "../types";
import type { ConnectorVersion } from "../version";

function validatePart(value: number, name: string, issues: ConnectorIssue[]): void {
  if (!Number.isInteger(value) || value < 0) {
    issues.push(
      connectorError(
        "invalid_version_part",
        `Connector version ${name} must be a non-negative integer`,
        `version.${name}`,
      ),
    );
  }
}

/** Validate that a version's numeric components are non-negative integers. */
export function validateConnectorVersion(version: ConnectorVersion): ConnectorIssue[] {
  const issues: ConnectorIssue[] = [];
  validatePart(version.major, "major", issues);
  validatePart(version.minor, "minor", issues);
  validatePart(version.patch, "patch", issues);
  return issues;
}
