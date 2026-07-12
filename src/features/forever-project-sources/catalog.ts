/**
 * Forever Project Sources — catalogue data model.
 *
 * A {@link ProjectSourceCatalogEntry} pairs a {@link ProjectSourceDefinition}
 * with whether it is currently enabled and optional registration notes — a
 * definition is *what* a source is, an entry is *how it currently stands* in a
 * catalogue. A {@link ProjectSourceCatalog} is the immutable data model of a
 * catalogue: an id and its ordered entries. It is the canonical shape of "every
 * source that entered the ecosystem" — for one project or for many.
 *
 * This is the *data* shape of a catalogue; the deterministic in-memory lookup
 * lives in {@link import("./registry").ProjectSourceRegistry}. The helpers here
 * are pure and immutable — they never mutate an input, so identical inputs
 * always yield an equal result and callers can share a catalogue freely.
 * Multiple received revisions of the same document coexist as separate entries
 * sharing a document key; the version helpers order and resolve them without
 * any storage. RC4.4 persists nothing, reads no clock, and holds no global
 * singleton.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ProjectSourceDefinition } from "./definition";
import { projectSourceDocumentKey } from "./helpers";
import type { ProjectSourceId } from "./types";
import { compareProjectSourceVersion } from "./version";

/** One source in a catalogue: its definition plus its current standing. */
export interface ProjectSourceCatalogEntry {
  definition: ProjectSourceDefinition;
  /** Whether the source is switched on in this catalogue. */
  enabled: boolean;
  /** When the source was registered, supplied by the caller. */
  registeredAt?: ISODateTime;
  /** Free-text notes about this registration. */
  notes?: string;
}

/** The immutable data model of a project-source catalogue. */
export interface ProjectSourceCatalog {
  id: string;
  name?: string;
  entries: ProjectSourceCatalogEntry[];
}

/** An empty catalogue with the given id and optional name. */
export function emptyProjectSourceCatalog(id: string, name?: string): ProjectSourceCatalog {
  return name === undefined ? { id, entries: [] } : { id, name, entries: [] };
}

/**
 * Append an entry, returning a new {@link ProjectSourceCatalog}.
 *
 * Immutable: the input catalogue is never mutated.
 */
export function addProjectSourceCatalogEntry(
  catalog: ProjectSourceCatalog,
  entry: ProjectSourceCatalogEntry,
): ProjectSourceCatalog {
  return { ...catalog, entries: [...catalog.entries, entry] };
}

/** The entry whose source has the given id, or `undefined`. */
export function findProjectSourceCatalogEntry(
  catalog: ProjectSourceCatalog,
  sourceId: ProjectSourceId,
): ProjectSourceCatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.definition.identity.id === sourceId);
}

/** Every enabled entry in the catalogue, in catalogue order. */
export function listEnabledProjectSourceCatalogEntries(
  catalog: ProjectSourceCatalog,
): ProjectSourceCatalogEntry[] {
  return catalog.entries.filter((entry) => entry.enabled);
}

/** Every entry belonging to a project, in catalogue order. */
export function listProjectSourceCatalogEntriesForProject(
  catalog: ProjectSourceCatalog,
  projectId: string,
): ProjectSourceCatalogEntry[] {
  return catalog.entries.filter((entry) => entry.definition.identity.projectId === projectId);
}

/**
 * Every catalogued revision of one document — the entries sharing a
 * `projectId:slug` document key — ordered oldest revision first.
 *
 * Pure and immutable: the catalogue is never mutated and equal versions keep
 * their catalogue order. This is how the registry supports multiple versions
 * of the same document without implementing storage.
 */
export function listProjectSourceCatalogVersions(
  catalog: ProjectSourceCatalog,
  documentKey: string,
): ProjectSourceCatalogEntry[] {
  return catalog.entries
    .filter((entry) => projectSourceDocumentKey(entry.definition.identity) === documentKey)
    .sort((a, b) => compareProjectSourceVersion(a.definition.version, b.definition.version));
}

/**
 * The entry carrying the highest catalogued revision of one document, or
 * `undefined` when the catalogue holds none. Equal revisions resolve to the
 * later catalogue entry (the ordering is stable).
 */
export function latestProjectSourceCatalogEntry(
  catalog: ProjectSourceCatalog,
  documentKey: string,
): ProjectSourceCatalogEntry | undefined {
  const versions = listProjectSourceCatalogVersions(catalog, documentKey);
  return versions.length > 0 ? versions[versions.length - 1] : undefined;
}
