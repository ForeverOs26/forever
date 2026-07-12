/**
 * Forever Project Sources — the source provider contract.
 *
 * A {@link ProjectSourceProvider} is the reusable seam between a concrete
 * described source and the registry: it exposes a
 * {@link ProjectSourceDefinition} that fully describes one catalogued
 * document. RC4.4 defines the contract only; a future release implements it to
 * plug an uploader, scanner, or intake path into the registry without any
 * existing code changing.
 *
 * Providers are pure descriptors: the contract exposes description, never
 * transport. Reading a file, fetching a URL, extracting content, and any IO
 * live entirely outside this contract — mirroring the Import (RC3.1), Sync
 * (RC3.2), Source Registry (RC3.3), Connectors (RC3.4), Pipeline (RC3.5),
 * Project Integration (RC4.0), Project Template (RC4.2), and Project Factory
 * (RC4.3) provider contracts.
 */

import type { ProjectSourceDefinition } from "../definition";
import type { ProjectSourceDocumentType, ProjectSourceFileFormat } from "../descriptor";
import { projectSourceDocumentKey } from "../helpers";

/** The contract every project-source provider satisfies. */
export interface ProjectSourceProvider {
  /** The declarative description of the source this provider represents. */
  readonly definition: ProjectSourceDefinition;
}

/**
 * Identity helper that pins an object to the {@link ProjectSourceProvider}
 * contract.
 *
 * Gives implementations full type-checking and inference without forcing a
 * class; the returned value is the provider unchanged.
 */
export function defineProjectSourceProvider<P extends ProjectSourceProvider>(provider: P): P {
  return provider;
}

/** Whether a provider's source describes the given document type. */
export function projectSourceProviderDescribes(
  provider: ProjectSourceProvider,
  documentType: ProjectSourceDocumentType,
): boolean {
  return provider.definition.descriptor.documentType === documentType;
}

/** Whether a provider's source belongs to the given project. */
export function projectSourceProviderCoversProject(
  provider: ProjectSourceProvider,
  projectId: string,
): boolean {
  return provider.definition.identity.projectId === projectId;
}

/** The file format a provider's source arrives in. */
export function projectSourceProviderFormat(
  provider: ProjectSourceProvider,
): ProjectSourceFileFormat {
  return provider.definition.descriptor.fileFormat;
}

/** The `projectId:slug` document key a provider's source belongs to. */
export function projectSourceProviderDocumentKey(provider: ProjectSourceProvider): string {
  return projectSourceDocumentKey(provider.definition.identity);
}
