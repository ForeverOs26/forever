/**
 * Forever Project Template — the package provider contract.
 *
 * A {@link ProjectPackageProvider} is the reusable seam between a concrete project
 * package and the registry: it exposes a {@link ProjectPackage} that fully
 * describes what the project provides and, optionally, the
 * {@link ProjectTemplate} it conforms to. RC4.2 defines the contract only; a
 * future project implements it to plug its package into the registry without any
 * existing code changing.
 *
 * Providers are pure descriptors: the contract exposes description, never
 * execution. Building a registry, resolving a reference against real data, running
 * a stage, and any IO live entirely outside this contract — mirroring the
 * Import (RC3.1), Sync (RC3.2), Source Registry (RC3.3), Connectors (RC3.4),
 * Pipeline (RC3.5), and Project Integration (RC4.0) provider contracts.
 */

import type { ProjectComponentKind } from "../component";
import { projectPackageCoversEntity, projectPackageProvidesComponent } from "../package";
import type { ProjectPackage } from "../package";
import type { ProjectTemplate } from "../template";
import type { ProjectPackageEntityKind } from "../types";

/** The contract every project package provider satisfies. */
export interface ProjectPackageProvider {
  /** The declarative description of the package this provider represents. */
  readonly package: ProjectPackage;
  /** The template the package conforms to, when the provider ships it. */
  readonly template?: ProjectTemplate;
}

/**
 * Identity helper that pins an object to the {@link ProjectPackageProvider}
 * contract.
 *
 * Gives implementations full type-checking and inference without forcing a class;
 * the returned value is the provider unchanged.
 */
export function defineProjectPackageProvider<P extends ProjectPackageProvider>(provider: P): P {
  return provider;
}

/** Whether a provider's package declares that it provides the given component kind. */
export function projectPackageProviderProvides(
  provider: ProjectPackageProvider,
  kind: ProjectComponentKind,
): boolean {
  return projectPackageProvidesComponent(provider.package, kind);
}

/** Whether a provider's package declares that its data covers the given entity kind. */
export function projectPackageProviderCovers(
  provider: ProjectPackageProvider,
  kind: ProjectPackageEntityKind,
): boolean {
  return projectPackageCoversEntity(provider.package, kind);
}

/** The number of component kinds a provider's package provides. */
export function projectPackageProviderComponentCount(
  provider: ProjectPackageProvider,
): number {
  return provider.package.provides.length;
}
