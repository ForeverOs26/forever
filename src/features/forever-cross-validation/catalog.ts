/**
 * Forever Cross-Source Validation — catalogue data model.
 *
 * A {@link CrossValidationCatalogEntry} pairs a {@link CrossValidationReport}
 * with whether it is currently enabled and optional registration notes — a
 * report is *what* one examination described, an entry is *how it currently
 * stands* in a catalogue. A {@link CrossValidationCatalog} is the immutable
 * data model of a catalogue: an id and its ordered entries.
 *
 * This is the *data* shape of a catalogue; the deterministic in-memory lookup
 * lives in {@link import("./registry").CrossValidationRegistry}. The helpers
 * here are pure and immutable — they never mutate an input, so identical
 * inputs always yield an equal result and callers can share a catalogue
 * freely. RC4.7 persists nothing, reads no clock, and holds no global
 * singleton. It mirrors the RC4.4, RC4.5, and RC4.6 catalogue models so the
 * foundations catalogue the same way.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { CrossValidationReport } from "./report";

/** One described report in a catalogue: the report plus its current standing. */
export interface CrossValidationCatalogEntry {
  report: CrossValidationReport;
  /** Whether the report is switched on in this catalogue. */
  enabled: boolean;
  /** When the report was registered, supplied by the caller. */
  registeredAt?: ISODateTime;
  /** Free-text notes about this registration. */
  notes?: string;
}

/** The immutable data model of a cross-validation catalogue. */
export interface CrossValidationCatalog {
  id: string;
  name?: string;
  entries: CrossValidationCatalogEntry[];
}

/** An empty catalogue with the given id and optional name. */
export function emptyCrossValidationCatalog(id: string, name?: string): CrossValidationCatalog {
  return name === undefined ? { id, entries: [] } : { id, name, entries: [] };
}

/**
 * Append an entry, returning a new {@link CrossValidationCatalog}.
 *
 * Immutable: the input catalogue is never mutated. Whether the entry
 * duplicates a report already catalogued is validation's judgement to report
 * — never silently resolved here.
 */
export function addCrossValidationCatalogEntry(
  catalog: CrossValidationCatalog,
  entry: CrossValidationCatalogEntry,
): CrossValidationCatalog {
  return { ...catalog, entries: [...catalog.entries, entry] };
}

/** The entry cataloguing a report (by report id), or `undefined`. */
export function findCrossValidationCatalogEntry(
  catalog: CrossValidationCatalog,
  reportId: string,
): CrossValidationCatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.report.id === reportId);
}

/** Every enabled entry in the catalogue, in catalogue order. */
export function listEnabledCrossValidationCatalogEntries(
  catalog: CrossValidationCatalog,
): CrossValidationCatalogEntry[] {
  return catalog.entries.filter((entry) => entry.enabled);
}

/** Every entry examining one project (by `proj_` id), in catalogue order. */
export function listCrossValidationCatalogEntriesForProject(
  catalog: CrossValidationCatalog,
  projectId: string,
): CrossValidationCatalogEntry[] {
  return catalog.entries.filter((entry) => entry.report.projectId === projectId);
}
