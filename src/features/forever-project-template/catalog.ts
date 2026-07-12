/**
 * Forever Project Template — catalogue data model.
 *
 * A {@link ProjectCatalogEntry} pairs a {@link ProjectPackage} with whether it is
 * currently enabled and optional registration notes — a package is *what* a
 * project provides, an entry is *how it currently stands* in a catalogue. A
 * {@link ProjectCatalog} is the immutable data model of a catalogue: an id and its
 * ordered entries.
 *
 * This is the *data* shape of a catalogue; the deterministic in-memory lookup
 * lives in {@link import("./registry").ProjectPackageRegistry}. The helpers here
 * are pure and immutable — they never mutate an input, so identical inputs always
 * yield an equal result and callers can share a catalogue freely. RC4.2 persists
 * nothing, reads no clock, and holds no global singleton.
 */

import type { ProjectPackage } from "./package";
import type { ISODateTime } from "@/features/forever-database";
import type { ProjectPackageId } from "./types";

/** One package in a catalogue: its descriptor plus its current standing. */
export interface ProjectCatalogEntry {
  package: ProjectPackage;
  /** Whether the package is switched on in this catalogue. */
  enabled: boolean;
  /** When the package was registered, supplied by the caller. */
  registeredAt?: ISODateTime;
  /** Free-text notes about this registration. */
  notes?: string;
}

/** The immutable data model of a package catalogue. */
export interface ProjectCatalog {
  id: string;
  name?: string;
  entries: ProjectCatalogEntry[];
}

/** An empty catalogue with the given id and optional name. */
export function emptyProjectCatalog(id: string, name?: string): ProjectCatalog {
  return name === undefined ? { id, entries: [] } : { id, name, entries: [] };
}

/**
 * Append an entry, returning a new {@link ProjectCatalog}.
 *
 * Immutable: the input catalogue is never mutated.
 */
export function addProjectCatalogEntry(
  catalog: ProjectCatalog,
  entry: ProjectCatalogEntry,
): ProjectCatalog {
  return { ...catalog, entries: [...catalog.entries, entry] };
}

/** The entry whose package has the given id, or `undefined`. */
export function findProjectCatalogEntry(
  catalog: ProjectCatalog,
  packageId: ProjectPackageId,
): ProjectCatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.package.identity.id === packageId);
}

/** Every enabled entry in the catalogue, in catalogue order. */
export function listEnabledProjectCatalogEntries(
  catalog: ProjectCatalog,
): ProjectCatalogEntry[] {
  return catalog.entries.filter((entry) => entry.enabled);
}
