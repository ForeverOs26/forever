/**
 * Forever Canonical Project Database — catalogue data model.
 *
 * A {@link ProjectCatalogEntry} pairs a {@link ProjectRecord} with whether it
 * is currently enabled and optional registration notes — a record is *what* a
 * project canonically is, an entry is *how it currently stands* in a
 * catalogue. A {@link ProjectCatalog} is the immutable data model of a
 * catalogue: an id and its ordered entries.
 *
 * This is the *data* shape of a catalogue; the deterministic in-memory lookup
 * lives in {@link import("./registry").ProjectRegistry}. The helpers here are
 * pure and immutable — they never mutate an input, so identical inputs always
 * yield an equal result and callers can share a catalogue freely. RC4.6
 * persists nothing, reads no clock, and holds no global singleton.
 *
 * Deliberately distinct from the RC4.2 template catalogue (which registers
 * page templates): this catalogue registers canonical project records. The
 * `ProjectCatalog` concept keeps its canonical name, while the helpers carry
 * the module's `projectDatabase` prefix so their runtime names never clash
 * with the RC4.2 catalogue helpers when both barrels are wired together.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ProjectRecord } from "./record";

/** One canonical record in a catalogue: the record plus its current standing. */
export interface ProjectCatalogEntry {
  record: ProjectRecord;
  /** Whether the record is switched on in this catalogue. */
  enabled: boolean;
  /** When the record was registered, supplied by the caller. */
  registeredAt?: ISODateTime;
  /** Free-text notes about this registration. */
  notes?: string;
}

/** The immutable data model of a canonical project catalogue. */
export interface ProjectCatalog {
  id: string;
  name?: string;
  entries: ProjectCatalogEntry[];
}

/** An empty catalogue with the given id and optional name. */
export function emptyProjectDatabaseCatalog(id: string, name?: string): ProjectCatalog {
  return name === undefined ? { id, entries: [] } : { id, name, entries: [] };
}

/**
 * Append an entry, returning a new {@link ProjectCatalog}.
 *
 * Immutable: the input catalogue is never mutated. Whether the entry
 * duplicates a project already catalogued is validation's judgement to
 * report — never silently resolved here.
 */
export function addProjectDatabaseCatalogEntry(
  catalog: ProjectCatalog,
  entry: ProjectCatalogEntry,
): ProjectCatalog {
  return { ...catalog, entries: [...catalog.entries, entry] };
}

/** The entry canonicalizing a project (by `proj_` id), or `undefined`. */
export function findProjectDatabaseCatalogEntry(
  catalog: ProjectCatalog,
  projectId: string,
): ProjectCatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.record.identity.projectId === projectId);
}

/** Every enabled entry in the catalogue, in catalogue order. */
export function listEnabledProjectDatabaseCatalogEntries(
  catalog: ProjectCatalog,
): ProjectCatalogEntry[] {
  return catalog.entries.filter((entry) => entry.enabled);
}
