/**
 * Forever Project Factory — catalogue data model.
 *
 * A {@link FactoryCatalogEntry} pairs a {@link FactoryDefinition} with whether
 * it is currently enabled and optional registration notes — a definition is
 * *what* a factory is, an entry is *how it currently stands* in a catalogue. A
 * {@link FactoryCatalog} is the immutable data model of a catalogue: an id and
 * its ordered entries.
 *
 * This is the *data* shape of a catalogue; the deterministic in-memory lookup
 * lives in {@link import("./registry").FactoryRegistry}. The helpers here are
 * pure and immutable — they never mutate an input, so identical inputs always
 * yield an equal result and callers can share a catalogue freely. RC4.3
 * persists nothing, reads no clock, and holds no global singleton.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { FactoryDefinition } from "./definition";
import type { FactoryId } from "./types";

/** One factory in a catalogue: its definition plus its current standing. */
export interface FactoryCatalogEntry {
  definition: FactoryDefinition;
  /** Whether the factory is switched on in this catalogue. */
  enabled: boolean;
  /** When the factory was registered, supplied by the caller. */
  registeredAt?: ISODateTime;
  /** Free-text notes about this registration. */
  notes?: string;
}

/** The immutable data model of a factory catalogue. */
export interface FactoryCatalog {
  id: string;
  name?: string;
  entries: FactoryCatalogEntry[];
}

/** An empty catalogue with the given id and optional name. */
export function emptyFactoryCatalog(id: string, name?: string): FactoryCatalog {
  return name === undefined ? { id, entries: [] } : { id, name, entries: [] };
}

/**
 * Append an entry, returning a new {@link FactoryCatalog}.
 *
 * Immutable: the input catalogue is never mutated.
 */
export function addFactoryCatalogEntry(
  catalog: FactoryCatalog,
  entry: FactoryCatalogEntry,
): FactoryCatalog {
  return { ...catalog, entries: [...catalog.entries, entry] };
}

/** The entry whose factory has the given id, or `undefined`. */
export function findFactoryCatalogEntry(
  catalog: FactoryCatalog,
  factoryId: FactoryId,
): FactoryCatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.definition.identity.id === factoryId);
}

/** Every enabled entry in the catalogue, in catalogue order. */
export function listEnabledFactoryCatalogEntries(catalog: FactoryCatalog): FactoryCatalogEntry[] {
  return catalog.entries.filter((entry) => entry.enabled);
}
