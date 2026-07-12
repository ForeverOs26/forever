/**
 * Forever Project Integration — registry entry and catalogue models.
 *
 * A {@link ProjectIntegrationRegistryEntry} pairs a
 * {@link ProjectIntegrationDefinition} with whether it is currently enabled and
 * optional registration notes — a definition is *what* an integration is, an
 * entry is *how it currently stands* in a catalogue. A
 * {@link ProjectIntegrationRegistry} is the immutable data model of a catalogue:
 * an id and its ordered entries.
 *
 * This is the *data* shape of a registry; the deterministic in-memory lookup
 * that resolves definitions lives in
 * {@link import("./registry").ProjectIntegrationDefinitionRegistry}. The helpers
 * here are pure and immutable — they never mutate an input, so identical inputs
 * always yield an equal result and callers can share a registry freely. RC4.0
 * persists nothing.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ProjectIntegrationDefinition } from "./definition";
import type { ProjectIntegrationId } from "./types";

/** One integration in a catalogue: its definition plus its current standing. */
export interface ProjectIntegrationRegistryEntry {
  definition: ProjectIntegrationDefinition;
  /** Whether the integration is switched on in this catalogue. */
  enabled: boolean;
  /** When the integration was registered, supplied by the caller. */
  registeredAt?: ISODateTime;
  /** Free-text notes about this registration. */
  notes?: string;
}

/** The immutable data model of an integration catalogue. */
export interface ProjectIntegrationRegistry {
  id: string;
  name?: string;
  entries: ProjectIntegrationRegistryEntry[];
}

/** An empty registry with the given id and optional name. */
export function emptyProjectIntegrationRegistry(
  id: string,
  name?: string,
): ProjectIntegrationRegistry {
  return name === undefined ? { id, entries: [] } : { id, name, entries: [] };
}

/**
 * Append an entry, returning a new {@link ProjectIntegrationRegistry}.
 *
 * Immutable: the input registry is never mutated.
 */
export function addProjectIntegrationEntry(
  registry: ProjectIntegrationRegistry,
  entry: ProjectIntegrationRegistryEntry,
): ProjectIntegrationRegistry {
  return { ...registry, entries: [...registry.entries, entry] };
}

/** The entry whose definition has the given integration id, or `undefined`. */
export function findProjectIntegrationEntry(
  registry: ProjectIntegrationRegistry,
  integrationId: ProjectIntegrationId,
): ProjectIntegrationRegistryEntry | undefined {
  return registry.entries.find((entry) => entry.definition.identity.id === integrationId);
}

/** Every enabled entry in the registry, in registry order. */
export function listEnabledProjectIntegrationEntries(
  registry: ProjectIntegrationRegistry,
): ProjectIntegrationRegistryEntry[] {
  return registry.entries.filter((entry) => entry.enabled);
}
