/**
 * Forever Source Registry — the source provider contract.
 *
 * A {@link SourceProvider} is the reusable seam between a concrete source and the
 * registry: it exposes a {@link SourceDefinition} that fully describes what the
 * source is and can do. RC3.3 defines the contract only; later releases
 * implement it for the Developer Website, CRM, Marketplace, Forever Database,
 * Manual Entry, PDF, Excel, CSV, JSON, API, AI Agent, and future providers.
 *
 * Providers are pure descriptors: the contract exposes description, never
 * transport. Fetching, authentication, parsing, and any IO live entirely outside
 * this contract, so a provider is trivially unit-testable and never touches the
 * network — mirroring the Forever Import (RC3.1) adapter and Forever Sync (RC3.2)
 * connector contracts.
 */

import { hasSourceCapability, type SourceCapabilityKind } from "../capability";
import type { SourceDefinition } from "../definition";
import type { SourceEntityKind } from "../types";

/** The contract every source provider satisfies. */
export interface SourceProvider {
  /** The declarative description of the source this provider represents. */
  readonly definition: SourceDefinition;
}

/**
 * Identity helper that pins an object to the {@link SourceProvider} contract.
 *
 * Gives implementations full type-checking and inference without forcing a
 * class; the returned value is the provider unchanged.
 */
export function defineSourceProvider<P extends SourceProvider>(provider: P): P {
  return provider;
}

/** Whether a provider's source supplies the given canonical entity kind. */
export function sourceProvides(provider: SourceProvider, kind: SourceEntityKind): boolean {
  return provider.definition.supportedEntities.includes(kind);
}

/** Whether a provider's source declares the given capability as supported. */
export function sourceSupports(
  provider: SourceProvider,
  capability: SourceCapabilityKind,
): boolean {
  return hasSourceCapability(provider.definition.capabilities, capability);
}
