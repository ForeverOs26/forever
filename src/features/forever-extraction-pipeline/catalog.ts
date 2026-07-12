/**
 * Forever Extraction Pipeline — catalogue data model.
 *
 * An {@link ExtractionCatalogEntry} pairs an {@link ExtractionDefinition}
 * with whether it is currently enabled and optional registration notes — a
 * definition is *what* a pipeline is, an entry is *how it currently stands*
 * in a catalogue. An {@link ExtractionCatalog} is the immutable data model of
 * a catalogue: an id and its ordered entries.
 *
 * This is the *data* shape of a catalogue; the deterministic in-memory lookup
 * lives in {@link import("./registry").ExtractionRegistry}. The helpers here
 * are pure and immutable — they never mutate an input, so identical inputs
 * always yield an equal result and callers can share a catalogue freely.
 * RC4.5 persists nothing, reads no clock, and holds no global singleton.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ExtractionDefinition } from "./definition";
import type { ExtractionId } from "./types";

/** One pipeline in a catalogue: its definition plus its current standing. */
export interface ExtractionCatalogEntry {
  definition: ExtractionDefinition;
  /** Whether the pipeline is switched on in this catalogue. */
  enabled: boolean;
  /** When the pipeline was registered, supplied by the caller. */
  registeredAt?: ISODateTime;
  /** Free-text notes about this registration. */
  notes?: string;
}

/** The immutable data model of an extraction catalogue. */
export interface ExtractionCatalog {
  id: string;
  name?: string;
  entries: ExtractionCatalogEntry[];
}

/** An empty catalogue with the given id and optional name. */
export function emptyExtractionCatalog(id: string, name?: string): ExtractionCatalog {
  return name === undefined ? { id, entries: [] } : { id, name, entries: [] };
}

/**
 * Append an entry, returning a new {@link ExtractionCatalog}.
 *
 * Immutable: the input catalogue is never mutated.
 */
export function addExtractionCatalogEntry(
  catalog: ExtractionCatalog,
  entry: ExtractionCatalogEntry,
): ExtractionCatalog {
  return { ...catalog, entries: [...catalog.entries, entry] };
}

/** The entry whose definition has the given id, or `undefined`. */
export function findExtractionCatalogEntry(
  catalog: ExtractionCatalog,
  definitionId: ExtractionId,
): ExtractionCatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.definition.identity.id === definitionId);
}

/** Every enabled entry in the catalogue, in catalogue order. */
export function listEnabledExtractionCatalogEntries(
  catalog: ExtractionCatalog,
): ExtractionCatalogEntry[] {
  return catalog.entries.filter((entry) => entry.enabled);
}
