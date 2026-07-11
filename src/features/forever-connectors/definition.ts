/**
 * Forever Connectors — connector definition.
 *
 * A {@link ConnectorDefinition} is the complete, declarative description of one
 * connector: its identity and version, what it can do at the transport level,
 * the configuration schema it needs, which canonical entities it carries, which
 * directions of flow it supports, and — optionally — which registered source it
 * binds to. It is the unit the registry stores and the validation pipeline
 * judges.
 *
 * The definition reuses the neighbouring foundations rather than restating them:
 * `supportedEntities` are the Forever Import (RC3.1) entity kinds, `directions`
 * is the Forever Sync (RC3.2) direction vocabulary, and the optional `sourceId`
 * points at a Forever Source Registry (RC3.3) source — so a described connector
 * lines up with the source it serves and the sync path that will later consume
 * it. It carries no connection detail, credential, or transport — the
 * configuration is a schema of what would be needed, never the values.
 */

import type { SyncDirection } from "@/features/forever-sync";
import type { SourceId } from "@/features/forever-source-registry";

import type { ConnectorCapability } from "./capability";
import type { ConnectorConfiguration } from "./configuration";
import type { ConnectorIdentity } from "./identity";
import type { ConnectorMetadata } from "./metadata";
import type { ConnectorEntityKind } from "./types";
import type { ConnectorVersion } from "./version";

/** The full declarative description of one connector. */
export interface ConnectorDefinition {
  identity: ConnectorIdentity;
  version: ConnectorVersion;
  /** Everything this connector can do; may include explicitly unsupported kinds. */
  capabilities: ConnectorCapability[];
  /** The schema of the settings this connector needs. Never holds values. */
  configuration: ConnectorConfiguration;
  /** Canonical entity kinds this connector carries. Reuses the RC3.1 kinds. */
  supportedEntities: ConnectorEntityKind[];
  /** The directions of flow this connector supports. Reuses the RC3.2 vocabulary. */
  directions: SyncDirection[];
  /** Optional bridge to RC3.3: the registered source this connector serves. */
  sourceId?: SourceId;
  metadata?: ConnectorMetadata;
}

/**
 * Identity helper that pins an object to the {@link ConnectorDefinition} shape.
 *
 * Gives call sites full type-checking and inference without forcing a factory;
 * the returned value is the definition unchanged.
 */
export function defineConnector(definition: ConnectorDefinition): ConnectorDefinition {
  return definition;
}
