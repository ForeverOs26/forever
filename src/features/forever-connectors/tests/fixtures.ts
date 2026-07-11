/**
 * Forever Connectors — shared test fixtures.
 *
 * Deterministic builders for identities, versions, capabilities, configurations,
 * definitions, entries, and registries. Every builder takes a partial override
 * so tests state only what they exercise, and the defaults describe a realistic
 * future connector (the Developer Website) so the fixtures double as
 * documentation.
 */

import { connectorCapability, type ConnectorCapability } from "../capability";
import {
  connectorConfigField,
  type ConnectorConfiguration,
} from "../configuration";
import type { ConnectorDefinition } from "../definition";
import type { ConnectorRegistry, ConnectorRegistryEntry } from "../entry";
import type { ConnectorIdentity } from "../identity";
import { connectorVersion } from "../version";

export function makeIdentity(overrides: Partial<ConnectorIdentity> = {}): ConnectorIdentity {
  return {
    id: "conn_developer_website",
    slug: "developer-website",
    name: "Developer Website",
    protocol: "http",
    targetSystem: "website",
    ...overrides,
  };
}

export function makeCapabilities(): ConnectorCapability[] {
  return [
    connectorCapability("connect"),
    connectorCapability("read"),
    connectorCapability("list"),
    connectorCapability("write", false),
  ];
}

export function makeConfiguration(): ConnectorConfiguration {
  return {
    fields: [
      connectorConfigField("base_url", "url", { required: true, label: "Base URL" }),
      connectorConfigField("api_key", "secret", { required: true }),
    ],
  };
}

export function makeDefinition(overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  return {
    identity: makeIdentity(),
    version: connectorVersion(0, 1, 0),
    capabilities: makeCapabilities(),
    configuration: makeConfiguration(),
    supportedEntities: ["project", "media"],
    directions: ["pull"],
    sourceId: "src_developer_website",
    ...overrides,
  };
}

export function makeEntry(overrides: Partial<ConnectorRegistryEntry> = {}): ConnectorRegistryEntry {
  return {
    definition: makeDefinition(),
    status: "unconfigured",
    registeredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeRegistry(overrides: Partial<ConnectorRegistry> = {}): ConnectorRegistry {
  return {
    id: "forever-connectors",
    name: "Forever Connectors",
    entries: [makeEntry()],
    ...overrides,
  };
}
