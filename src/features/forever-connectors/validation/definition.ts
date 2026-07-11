/**
 * Forever Connectors — definition validation.
 *
 * Composes the identity, version, capability, and configuration guards and adds
 * the checks that span a whole {@link ConnectorDefinition}: a connector must
 * carry at least one supported entity kind (a connector that carries nothing is
 * meaningless), must declare at least one direction of flow, and must not repeat
 * a direction. All checks return issues; none throw.
 */

import type { ConnectorDefinition } from "../definition";
import { connectorError } from "../result";
import type { ConnectorIssue } from "../types";
import { validateConnectorCapabilities } from "./capability";
import { validateConnectorConfiguration } from "./configuration";
import { validateConnectorIdentity } from "./identity";
import { validateConnectorVersion } from "./version";

/** Validate a whole connector definition, composing every sub-guard. */
export function validateConnectorDefinition(definition: ConnectorDefinition): ConnectorIssue[] {
  const issues: ConnectorIssue[] = [];
  issues.push(...validateConnectorIdentity(definition.identity));
  issues.push(...validateConnectorVersion(definition.version));
  issues.push(...validateConnectorCapabilities(definition.capabilities));
  issues.push(...validateConnectorConfiguration(definition.configuration));

  if (definition.supportedEntities.length === 0) {
    issues.push(
      connectorError(
        "no_supported_entities",
        "Connector must carry at least one canonical entity kind",
        "supportedEntities",
      ),
    );
  }

  if (definition.directions.length === 0) {
    issues.push(
      connectorError(
        "no_directions",
        "Connector must declare at least one direction of flow",
        "directions",
      ),
    );
  }
  const seenDirections = new Set<string>();
  definition.directions.forEach((direction, index) => {
    if (seenDirections.has(direction)) {
      issues.push(
        connectorError(
          "duplicate_direction",
          `Direction "${direction}" is declared more than once`,
          `directions.${index}`,
        ),
      );
    }
    seenDirections.add(direction);
  });

  return issues;
}
