/**
 * Forever Connectors — the connector provider contract.
 *
 * A {@link ConnectorProvider} is the reusable seam between a concrete connector
 * and the registry: it exposes a {@link ConnectorDefinition} that fully
 * describes what the connector is, what it can do, and what it needs. RC3.4
 * defines the contract only; later releases implement it for the Developer
 * Website, CRM, Marketplace, Forever Database, Manual, PDF, Excel, CSV, JSON,
 * API, AI Agent, and future transports.
 *
 * Providers are pure descriptors: the contract exposes description, never
 * transport. Connecting, authentication, requests, and any IO live entirely
 * outside this contract, so a provider is trivially unit-testable and never
 * touches the network — mirroring the Forever Import (RC3.1) adapter, the
 * Forever Sync (RC3.2) connector, and the Forever Source Registry (RC3.3)
 * provider contracts.
 */

import { hasConnectorCapability, type ConnectorCapabilityKind } from "../capability";
import { requiredConfigFields } from "../configuration";
import type { ConnectorDefinition } from "../definition";
import type { ConnectorEntityKind } from "../types";

/** The contract every connector provider satisfies. */
export interface ConnectorProvider {
  /** The declarative description of the connector this provider represents. */
  readonly definition: ConnectorDefinition;
}

/**
 * Identity helper that pins an object to the {@link ConnectorProvider} contract.
 *
 * Gives implementations full type-checking and inference without forcing a
 * class; the returned value is the provider unchanged.
 */
export function defineConnectorProvider<P extends ConnectorProvider>(provider: P): P {
  return provider;
}

/** Whether a provider's connector carries the given canonical entity kind. */
export function connectorCarries(
  provider: ConnectorProvider,
  kind: ConnectorEntityKind,
): boolean {
  return provider.definition.supportedEntities.includes(kind);
}

/** Whether a provider's connector declares the given capability as supported. */
export function connectorSupports(
  provider: ConnectorProvider,
  capability: ConnectorCapabilityKind,
): boolean {
  return hasConnectorCapability(provider.definition.capabilities, capability);
}

/** Whether a provider's connector needs any configuration before it is usable. */
export function connectorNeedsConfiguration(provider: ConnectorProvider): boolean {
  return requiredConfigFields(provider.definition.configuration).length > 0;
}
