/**
 * Forever Connectors — configuration-schema validation.
 *
 * Guards that a {@link ConnectorConfiguration} schema is well-formed: every field
 * has a non-empty key and a known {@link ConnectorConfigFieldKind}, no key is
 * declared twice, an `enum` field lists at least one allowed value, and a
 * non-`enum` field does not carry `enumValues` (a warning — the values would be
 * ignored). RC3.4 validates the *shape* of the schema; it never inspects,
 * requires, or fabricates a real configuration value. All checks return issues;
 * none throw.
 */

import {
  isKnownConfigFieldKind,
  type ConnectorConfiguration,
} from "../configuration";
import { isNonEmptyString } from "../helpers";
import { connectorError, connectorWarning } from "../result";
import type { ConnectorIssue } from "../types";

/** Validate a configuration schema for well-formed, unique, coherent fields. */
export function validateConnectorConfiguration(
  configuration: ConnectorConfiguration,
): ConnectorIssue[] {
  const issues: ConnectorIssue[] = [];
  const seen = new Set<string>();
  configuration.fields.forEach((field, index) => {
    if (!isNonEmptyString(field.key)) {
      issues.push(
        connectorError(
          "missing_config_key",
          "Configuration field is missing a key",
          `configuration.fields.${index}.key`,
        ),
      );
    } else if (seen.has(field.key)) {
      issues.push(
        connectorError(
          "duplicate_config_key",
          `Configuration field "${field.key}" is declared more than once`,
          `configuration.fields.${index}.key`,
        ),
      );
    } else {
      seen.add(field.key);
    }

    if (!isKnownConfigFieldKind(field.kind)) {
      issues.push(
        connectorError(
          "unknown_config_field_kind",
          `Unknown configuration field kind "${String(field.kind)}"`,
          `configuration.fields.${index}.kind`,
        ),
      );
      return;
    }

    if (field.kind === "enum") {
      if (field.enumValues === undefined || field.enumValues.length === 0) {
        issues.push(
          connectorError(
            "missing_enum_values",
            `Enum configuration field "${field.key}" must list at least one allowed value`,
            `configuration.fields.${index}.enumValues`,
          ),
        );
      }
    } else if (field.enumValues !== undefined) {
      issues.push(
        connectorWarning(
          "unexpected_enum_values",
          `Configuration field "${field.key}" of kind "${field.kind}" declares enumValues that will be ignored`,
          `configuration.fields.${index}.enumValues`,
        ),
      );
    }
  });
  return issues;
}
