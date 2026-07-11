/**
 * Forever Source Registry — registry entry and catalogue models.
 *
 * A {@link SourceRegistryEntry} pairs a {@link SourceDefinition} with its
 * current {@link SourceStatus} and optional registration notes — a definition is
 * *what* a source is, an entry is *how it currently stands* in a catalogue. A
 * {@link SourceRegistry} is the immutable data model of a catalogue: an id and
 * its ordered entries.
 *
 * This is the *data* shape of a registry; the deterministic in-memory lookup
 * that resolves definitions lives in {@link import("./registry").SourceDefinitionRegistry}.
 * The helpers here are pure and immutable — they never mutate an input, so
 * identical inputs always yield an equal result and callers can share a registry
 * freely. RC3.3 persists nothing.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { SourceDefinition } from "./definition";
import type { SourceStatus } from "./lifecycle";
import type { SourceId } from "./types";

/** One source in a catalogue: its definition plus its current standing. */
export interface SourceRegistryEntry {
  definition: SourceDefinition;
  status: SourceStatus;
  /** When the source was registered, supplied by the caller. */
  registeredAt?: ISODateTime;
  /** Free-text notes about this registration. */
  notes?: string;
}

/** The immutable data model of a source catalogue. */
export interface SourceRegistry {
  id: string;
  name?: string;
  entries: SourceRegistryEntry[];
}

/** An empty registry with the given id and optional name. */
export function emptySourceRegistry(id: string, name?: string): SourceRegistry {
  return name === undefined ? { id, entries: [] } : { id, name, entries: [] };
}

/**
 * Append an entry, returning a new {@link SourceRegistry}.
 *
 * Immutable: the input registry is never mutated.
 */
export function addSourceEntry(
  registry: SourceRegistry,
  entry: SourceRegistryEntry,
): SourceRegistry {
  return { ...registry, entries: [...registry.entries, entry] };
}

/** The entry whose definition has the given source id, or `undefined`. */
export function findSourceEntry(
  registry: SourceRegistry,
  sourceId: SourceId,
): SourceRegistryEntry | undefined {
  return registry.entries.find((entry) => entry.definition.identity.id === sourceId);
}

/** Every entry in the registry with the given status, in registry order. */
export function listSourceEntriesByStatus(
  registry: SourceRegistry,
  status: SourceStatus,
): SourceRegistryEntry[] {
  return registry.entries.filter((entry) => entry.status === status);
}
