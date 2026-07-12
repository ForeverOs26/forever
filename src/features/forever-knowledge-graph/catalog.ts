/**
 * Forever Knowledge Graph — catalogue data model.
 *
 * A {@link KnowledgeGraphCatalogEntry} pairs a {@link KnowledgeGraph} with
 * whether it is currently enabled and optional registration notes — a graph
 * is *what* one description represented, an entry is *how it currently
 * stands* in a catalogue. A {@link KnowledgeGraphCatalog} is the immutable
 * data model of a catalogue: an id and its ordered entries.
 *
 * This is the *data* shape of a catalogue; the deterministic in-memory lookup
 * lives in {@link import("./registry").KnowledgeGraphRegistry}. The helpers
 * here are pure and immutable — they never mutate an input, so identical
 * inputs always yield an equal result and callers can share a catalogue
 * freely. RC4.8 persists nothing, reads no clock, and holds no global
 * singleton. It mirrors the RC4.4, RC4.5, RC4.6, and RC4.7 catalogue models
 * so the foundations catalogue the same way.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { KnowledgeGraph } from "./graph";

/** One described graph in a catalogue: the graph plus its current standing. */
export interface KnowledgeGraphCatalogEntry {
  graph: KnowledgeGraph;
  /** Whether the graph is switched on in this catalogue. */
  enabled: boolean;
  /** When the graph was registered, supplied by the caller. */
  registeredAt?: ISODateTime;
  /** Free-text notes about this registration. */
  notes?: string;
}

/** The immutable data model of a knowledge-graph catalogue. */
export interface KnowledgeGraphCatalog {
  id: string;
  name?: string;
  entries: KnowledgeGraphCatalogEntry[];
}

/** An empty catalogue with the given id and optional name. */
export function emptyKnowledgeGraphCatalog(id: string, name?: string): KnowledgeGraphCatalog {
  return name === undefined ? { id, entries: [] } : { id, name, entries: [] };
}

/**
 * Append an entry, returning a new {@link KnowledgeGraphCatalog}.
 *
 * Immutable: the input catalogue is never mutated. Whether the entry
 * duplicates a graph already catalogued is validation's judgement to report
 * — never silently resolved here.
 */
export function addKnowledgeGraphCatalogEntry(
  catalog: KnowledgeGraphCatalog,
  entry: KnowledgeGraphCatalogEntry,
): KnowledgeGraphCatalog {
  return { ...catalog, entries: [...catalog.entries, entry] };
}

/** The entry cataloguing a graph (by graph id), or `undefined`. */
export function findKnowledgeGraphCatalogEntry(
  catalog: KnowledgeGraphCatalog,
  graphId: string,
): KnowledgeGraphCatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.graph.id === graphId);
}

/** Every enabled entry in the catalogue, in catalogue order. */
export function listEnabledKnowledgeGraphCatalogEntries(
  catalog: KnowledgeGraphCatalog,
): KnowledgeGraphCatalogEntry[] {
  return catalog.entries.filter((entry) => entry.enabled);
}

/** Every entry representing one project (by `proj_` id), in catalogue order. */
export function listKnowledgeGraphCatalogEntriesForProject(
  catalog: KnowledgeGraphCatalog,
  projectId: string,
): KnowledgeGraphCatalogEntry[] {
  return catalog.entries.filter((entry) => entry.graph.projectId === projectId);
}
