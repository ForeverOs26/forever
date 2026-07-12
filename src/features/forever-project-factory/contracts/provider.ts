/**
 * Forever Project Factory — the factory provider contract.
 *
 * A {@link FactoryProvider} is the reusable seam between a concrete factory and
 * the registry: it exposes a {@link FactoryDefinition} that fully describes
 * what the factory generates, from which RC4.2 templates, and through which
 * recipes. RC4.3 defines the contract only; a future release implements it to
 * plug a specialised factory into the registry without any existing code
 * changing.
 *
 * Providers are pure descriptors: the contract exposes description, never
 * execution. Planning a build, resolving a template against real data, running
 * a stage, and any IO live entirely outside this contract — mirroring the
 * Import (RC3.1), Sync (RC3.2), Source Registry (RC3.3), Connectors (RC3.4),
 * Pipeline (RC3.5), Project Integration (RC4.0), and Project Template (RC4.2)
 * provider contracts.
 */

import type { ProjectTemplateId } from "@/features/forever-project-template";

import type { FactoryDefinition } from "../definition";
import { factoryRecipeCount, factoryStepCount, factoryTemplateIds } from "../helpers";
import type { FactoryEntityKind } from "../types";

/** The contract every factory provider satisfies. */
export interface FactoryProvider {
  /** The declarative description of the factory this provider represents. */
  readonly definition: FactoryDefinition;
}

/**
 * Identity helper that pins an object to the {@link FactoryProvider} contract.
 *
 * Gives implementations full type-checking and inference without forcing a
 * class; the returned value is the provider unchanged.
 */
export function defineFactoryProvider<P extends FactoryProvider>(provider: P): P {
  return provider;
}

/** Whether a provider's factory declares that its outputs cover the given entity kind. */
export function factoryProviderCovers(provider: FactoryProvider, kind: FactoryEntityKind): boolean {
  return provider.definition.entities.includes(kind);
}

/** Whether a provider's factory generates from the given RC4.2 template. */
export function factoryProviderGeneratesFrom(
  provider: FactoryProvider,
  templateId: ProjectTemplateId,
): boolean {
  return factoryTemplateIds(provider.definition).includes(templateId);
}

/** The number of recipes a provider's factory declares. */
export function factoryProviderRecipeCount(provider: FactoryProvider): number {
  return factoryRecipeCount(provider.definition);
}

/** The number of steps across every recipe of a provider's factory. */
export function factoryProviderStepCount(provider: FactoryProvider): number {
  return factoryStepCount(provider.definition);
}
