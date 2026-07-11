/**
 * Forever Connectors — deterministic helpers.
 *
 * Pure, side-effect-free utilities shared across the foundation: a strict string
 * guard used by validation, stable key builders for identities and definitions,
 * and a deterministic bridge from a connector's `targetSystem` to the Forever
 * Sync (RC3.2) system it corresponds to. Given the same input they always return
 * the same output — no randomness, no clocks, no locale — so the whole module
 * stays deterministic and these helpers never need re-implementing per call
 * site.
 */

import type { SyncDirection, SyncSystem } from "@/features/forever-sync";

import type { ConnectorDefinition } from "./definition";
import type { ConnectorIdentity } from "./identity";

/** True only for a non-empty, non-whitespace string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Stable key for an identity, independent of its surrogate id:
 * `protocol:targetSystem:slug`. Two identities that speak the same protocol to
 * the same system under the same slug share a key.
 */
export function connectorIdentityKey(identity: ConnectorIdentity): string {
  return `${identity.protocol}:${identity.targetSystem}:${identity.slug}`;
}

/** Stable natural key for a definition, derived from its identity. */
export function connectorDefinitionKey(definition: ConnectorDefinition): string {
  return connectorIdentityKey(definition.identity);
}

/**
 * The Forever Sync (RC3.2) system a connector serves, read straight from its
 * identity. Kept as a named helper so call sites reference the binding by intent
 * rather than reaching into the identity shape.
 */
export function connectorSyncSystem(definition: ConnectorDefinition): SyncSystem {
  return definition.identity.targetSystem;
}

/** Whether a definition declares support for the given direction of flow. */
export function connectorSupportsDirection(
  definition: ConnectorDefinition,
  direction: SyncDirection,
): boolean {
  return definition.directions.includes(direction);
}
