/**
 * Forever Connectors — the validation pipeline.
 *
 * Composes the individual guards (identity, version, capabilities, configuration,
 * definition, and entry) into one deterministic pass over a
 * {@link ConnectorRegistry}. This is the single entry point a caller uses before
 * treating a catalogue as coherent. It never throws — it returns a structured
 * verdict.
 *
 * Cross-entry integrity is resolved here: a registry must have an id, and no two
 * entries may share a connector id or a natural `protocol:targetSystem:slug` key,
 * so a connector can never be registered twice under a different surrogate id.
 */

import type { ConnectorRegistry } from "../entry";
import { connectorDefinitionKey, isNonEmptyString } from "../helpers";
import { partitionConnectorIssues, connectorError } from "../result";
import type { ConnectorError, ConnectorIssue, ConnectorWarning } from "../types";
import { validateConnectorRegistryEntry } from "./entry";

/** The structured verdict of {@link validateConnectorRegistry}. */
export interface ConnectorValidation {
  valid: boolean;
  issues: ConnectorIssue[];
  errors: ConnectorError[];
  warnings: ConnectorWarning[];
}

/**
 * Run the full validation suite over a registry.
 *
 * Validates the registry id, every entry, and the uniqueness of both surrogate
 * ids and natural `protocol:targetSystem:slug` keys across entries. Issues from
 * every check are merged in a stable order.
 */
export function validateConnectorRegistry(registry: ConnectorRegistry): ConnectorValidation {
  const issues: ConnectorIssue[] = [];

  if (!isNonEmptyString(registry.id)) {
    issues.push(
      connectorError("missing_registry_id", "Connector registry is missing an id", "id"),
    );
  }

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  registry.entries.forEach((entry, index) => {
    issues.push(...validateConnectorRegistryEntry(entry));

    const id = entry.definition.identity.id;
    if (isNonEmptyString(id)) {
      if (seenIds.has(id)) {
        issues.push(
          connectorError(
            "duplicate_connector_id",
            `Connector id "${id}" is registered more than once`,
            `entries.${index}.definition.identity.id`,
          ),
        );
      }
      seenIds.add(id);
    }

    const key = connectorDefinitionKey(entry.definition);
    if (seenKeys.has(key)) {
      issues.push(
        connectorError(
          "duplicate_connector_key",
          `Connector "${key}" is registered more than once`,
          `entries.${index}.definition.identity.slug`,
        ),
      );
    }
    seenKeys.add(key);
  });

  const { errors, warnings } = partitionConnectorIssues(issues);
  return { valid: errors.length === 0, issues, errors, warnings };
}
