/**
 * Forever Project Readiness — catalogue data model.
 *
 * A {@link ReadinessCatalogEntry} pairs a {@link ReadinessReport} with
 * whether it is currently enabled and optional registration notes — a report
 * is *what* one examination concluded, an entry is *how it currently stands*
 * in a catalogue. A {@link ReadinessCatalog} is the immutable data model of
 * a catalogue: an id and its ordered entries.
 *
 * This is the *data* shape of a catalogue; the deterministic in-memory
 * lookup lives in {@link import("./registry").ReadinessRegistry}. The
 * helpers here are pure and immutable — they never mutate an input, so
 * identical inputs always yield an equal result and callers can share a
 * catalogue freely. RC4.9 persists nothing, reads no clock, and holds no
 * global singleton. It mirrors the RC4.4, RC4.5, RC4.6, RC4.7, and RC4.8
 * catalogue models so the foundations catalogue the same way.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ReadinessReport } from "./report";

/** One described report in a catalogue: the report plus its current standing. */
export interface ReadinessCatalogEntry {
  report: ReadinessReport;
  /** Whether the report is switched on in this catalogue. */
  enabled: boolean;
  /** When the report was registered, supplied by the caller. */
  registeredAt?: ISODateTime;
  /** Free-text notes about this registration. */
  notes?: string;
}

/** The immutable data model of a readiness catalogue. */
export interface ReadinessCatalog {
  id: string;
  name?: string;
  entries: ReadinessCatalogEntry[];
}

/** An empty catalogue with the given id and optional name. */
export function emptyReadinessCatalog(id: string, name?: string): ReadinessCatalog {
  return name === undefined ? { id, entries: [] } : { id, name, entries: [] };
}

/**
 * Append an entry, returning a new {@link ReadinessCatalog}.
 *
 * Immutable: the input catalogue is never mutated. Whether the entry
 * duplicates a report already catalogued is validation's judgement to report
 * — never silently resolved here.
 */
export function addReadinessCatalogEntry(
  catalog: ReadinessCatalog,
  entry: ReadinessCatalogEntry,
): ReadinessCatalog {
  return { ...catalog, entries: [...catalog.entries, entry] };
}

/** The entry cataloguing a report (by report id), or `undefined`. */
export function findReadinessCatalogEntry(
  catalog: ReadinessCatalog,
  reportId: string,
): ReadinessCatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.report.id === reportId);
}

/** Every enabled entry in the catalogue, in catalogue order. */
export function listEnabledReadinessCatalogEntries(
  catalog: ReadinessCatalog,
): ReadinessCatalogEntry[] {
  return catalog.entries.filter((entry) => entry.enabled);
}

/** Every entry concerning one project (by `proj_` id), in catalogue order. */
export function listReadinessCatalogEntriesForProject(
  catalog: ReadinessCatalog,
  projectId: string,
): ReadinessCatalogEntry[] {
  return catalog.entries.filter((entry) => entry.report.projectId === projectId);
}
