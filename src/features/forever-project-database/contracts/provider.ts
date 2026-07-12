/**
 * Forever Canonical Project Database — the project provider contract.
 *
 * A {@link ProjectProvider} is the reusable seam between one canonical
 * project record and the registry: it exposes a {@link ProjectRecord} that
 * fully describes the project's canonical state. RC4.6 defines the contract
 * only; a future release implements it to plug a concrete project into the
 * registry without any existing code changing.
 *
 * Providers are pure descriptors: the contract exposes description, never
 * execution. Persisting a record, applying a merge, resolving a conflict,
 * and any IO live entirely outside this contract — mirroring the Import
 * (RC3.1), Sync (RC3.2), Source Registry (RC3.3), Connectors (RC3.4),
 * Pipeline (RC3.5), Project Integration (RC4.0), Project Template (RC4.2),
 * Project Factory (RC4.3), Project Sources (RC4.4), and Extraction Pipeline
 * (RC4.5) provider contracts.
 */

import { distinctProjectSections, projectFieldCount, projectRevisionCount } from "../helpers";
import type { ProjectRecord } from "../record";
import type { ProjectSectionKey } from "../section";

/** The contract every canonical project provider satisfies. */
export interface ProjectProvider {
  /** The canonical record this provider represents. */
  readonly record: ProjectRecord;
}

/**
 * Identity helper that pins an object to the {@link ProjectProvider}
 * contract.
 *
 * Gives implementations full type-checking and inference without forcing a
 * class; the returned value is the provider unchanged.
 */
export function defineProjectProvider<P extends ProjectProvider>(provider: P): P {
  return provider;
}

/** The canonical `proj_` id of the project a provider represents. */
export function projectProviderProjectId(provider: ProjectProvider): string {
  return provider.record.identity.projectId;
}

/** Whether a provider's record holds a field under the given canonical section. */
export function projectProviderCovers(
  provider: ProjectProvider,
  section: ProjectSectionKey,
): boolean {
  return distinctProjectSections(provider.record.fields).includes(section);
}

/** The number of canonical fields a provider's record declares. */
export function projectProviderFieldCount(provider: ProjectProvider): number {
  return projectFieldCount(provider.record);
}

/** The number of revisions in a provider's record history. */
export function projectProviderRevisionCount(provider: ProjectProvider): number {
  return projectRevisionCount(provider.record);
}
