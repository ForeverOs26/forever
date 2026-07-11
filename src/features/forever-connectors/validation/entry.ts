/**
 * Forever Connectors — entry validation.
 *
 * Guards over a single {@link ConnectorRegistryEntry}: its status must be a known
 * {@link ConnectorStatus}, its health (when present) must carry a known
 * {@link ConnectorHealthLevel}, and its definition must pass full definition
 * validation. All checks return issues; none throw.
 */

import type { ConnectorRegistryEntry } from "../entry";
import { isKnownConnectorHealthLevel } from "../health";
import { connectorError } from "../result";
import { isKnownConnectorStatus } from "../status";
import type { ConnectorIssue } from "../types";
import { validateConnectorDefinition } from "./definition";

/** Validate one registry entry's status, health, and its definition. */
export function validateConnectorRegistryEntry(
  entry: ConnectorRegistryEntry,
): ConnectorIssue[] {
  const issues: ConnectorIssue[] = [];
  if (!isKnownConnectorStatus(entry.status)) {
    issues.push(
      connectorError(
        "unknown_status",
        `Registry entry has an unknown status "${String(entry.status)}"`,
        "status",
      ),
    );
  }
  if (entry.health !== undefined && !isKnownConnectorHealthLevel(entry.health.level)) {
    issues.push(
      connectorError(
        "unknown_health_level",
        `Registry entry has an unknown health level "${String(entry.health.level)}"`,
        "health.level",
      ),
    );
  }
  issues.push(...validateConnectorDefinition(entry.definition));
  return issues;
}
