/**
 * Forever Connectors — capability validation.
 *
 * Guards that a connector's capability list is well-formed: every entry names a
 * known {@link ConnectorCapabilityKind}, and no kind is declared twice (a
 * duplicate is ambiguous — a connector cannot both support and not support the
 * same kind). All checks return issues; none throw.
 */

import { isKnownConnectorCapabilityKind, type ConnectorCapability } from "../capability";
import { connectorError } from "../result";
import type { ConnectorIssue } from "../types";

/** Validate a capability list for known kinds and no duplicates. */
export function validateConnectorCapabilities(
  capabilities: readonly ConnectorCapability[],
): ConnectorIssue[] {
  const issues: ConnectorIssue[] = [];
  const seen = new Set<string>();
  capabilities.forEach((capability, index) => {
    if (!isKnownConnectorCapabilityKind(capability.kind)) {
      issues.push(
        connectorError(
          "unknown_capability_kind",
          `Unknown capability kind "${String(capability.kind)}"`,
          `capabilities.${index}.kind`,
        ),
      );
      return;
    }
    if (seen.has(capability.kind)) {
      issues.push(
        connectorError(
          "duplicate_capability",
          `Capability "${capability.kind}" is declared more than once`,
          `capabilities.${index}.kind`,
        ),
      );
    }
    seen.add(capability.kind);
  });
  return issues;
}
