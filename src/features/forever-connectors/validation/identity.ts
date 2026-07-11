/**
 * Forever Connectors — identity validation.
 *
 * Structural guards over a {@link ConnectorIdentity}: id, slug, and name must be
 * present, and the transport `protocol` and `targetSystem` must be known values
 * from the reused Forever Sync (RC3.2) vocabularies. All checks return issues;
 * none throw.
 *
 * RC3.2 exposes {@link SyncProtocol} and {@link SyncSystem} as types only (no
 * runtime constant list), so the guard lists here are pinned to those types with
 * `satisfies` — every entry must be a valid RC3.2 value, keeping the runtime
 * guard coupled to the shared vocabulary rather than inventing a parallel one.
 */

import type { SyncProtocol, SyncSystem } from "@/features/forever-sync";

import { isNonEmptyString } from "../helpers";
import type { ConnectorIdentity } from "../identity";
import { connectorError } from "../result";
import type { ConnectorIssue } from "../types";

/** The RC3.2 protocols, mirrored for runtime guarding and pinned to the type. */
const KNOWN_PROTOCOLS = [
  "http",
  "graphql",
  "webhook",
  "file",
  "memory",
  "manual",
] as const satisfies readonly SyncProtocol[];

/** The RC3.2 systems, mirrored for runtime guarding and pinned to the type. */
const KNOWN_SYSTEMS = [
  "website",
  "crm",
  "forever_database",
  "marketplace",
  "ai_agents",
  "manual",
  "api",
] as const satisfies readonly SyncSystem[];

function isKnownProtocol(value: unknown): boolean {
  return typeof value === "string" && (KNOWN_PROTOCOLS as readonly string[]).includes(value);
}

function isKnownSystem(value: unknown): boolean {
  return typeof value === "string" && (KNOWN_SYSTEMS as readonly string[]).includes(value);
}

/** Validate a connector identity's required fields and protocol/system. */
export function validateConnectorIdentity(identity: ConnectorIdentity): ConnectorIssue[] {
  const issues: ConnectorIssue[] = [];
  if (!isNonEmptyString(identity.id)) {
    issues.push(
      connectorError("missing_connector_id", "Connector identity is missing an id", "identity.id"),
    );
  }
  if (!isNonEmptyString(identity.slug)) {
    issues.push(
      connectorError(
        "missing_connector_slug",
        "Connector identity is missing a slug",
        "identity.slug",
      ),
    );
  }
  if (!isNonEmptyString(identity.name)) {
    issues.push(
      connectorError(
        "missing_connector_name",
        "Connector identity is missing a name",
        "identity.name",
      ),
    );
  }
  if (!isKnownProtocol(identity.protocol)) {
    issues.push(
      connectorError(
        "unknown_protocol",
        `Connector identity has an unknown protocol "${String(identity.protocol)}"`,
        "identity.protocol",
      ),
    );
  }
  if (!isKnownSystem(identity.targetSystem)) {
    issues.push(
      connectorError(
        "unknown_target_system",
        `Connector identity has an unknown target system "${String(identity.targetSystem)}"`,
        "identity.targetSystem",
      ),
    );
  }
  return issues;
}
