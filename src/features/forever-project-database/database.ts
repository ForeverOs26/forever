/**
 * Forever Canonical Project Database — the database data model.
 *
 * A {@link ProjectDatabase} is the immutable data model of the canonical
 * store: an id, an optional name, and its ordered {@link ProjectRecord}
 * entries — one canonical record per project, which the database validation
 * enforces by flagging any project described twice. This is the *data* shape;
 * the deterministic in-memory lookup lives in
 * {@link import("./registry").ProjectRegistry}.
 *
 * The helpers here are pure and immutable — they never mutate an input, so
 * identical inputs always yield an equal result and callers can share a
 * database freely. RC4.6 persists nothing, reads no clock, and holds no
 * global singleton: this is the described shape a future persistence layer
 * would store, never the store itself.
 */

import { projectRecordKey } from "./helpers";
import type { ProjectRecord } from "./record";

/** The immutable data model of the canonical project database. */
export interface ProjectDatabase {
  /** Stable identifier of the database, e.g. `pdb_forever`. */
  id: string;
  name?: string;
  /** The canonical records, one per project, in registration order. */
  records: ProjectRecord[];
}

/** An empty database with the given id and optional name. */
export function emptyProjectDatabase(id: string, name?: string): ProjectDatabase {
  return name === undefined ? { id, records: [] } : { id, name, records: [] };
}

/**
 * Append a record, returning a new {@link ProjectDatabase}.
 *
 * Immutable: the input database is never mutated. Whether the record
 * duplicates a project already described is validation's judgement to report
 * — never silently resolved here.
 */
export function addProjectRecord(
  database: ProjectDatabase,
  record: ProjectRecord,
): ProjectDatabase {
  return { ...database, records: [...database.records, record] };
}

/** The record canonicalizing a project (by `proj_` id), or `undefined`. */
export function findProjectRecord(
  database: ProjectDatabase,
  projectId: string,
): ProjectRecord | undefined {
  return database.records.find((record) => record.identity.projectId === projectId);
}

/** Whether the database holds a record for a project (by `proj_` id). */
export function hasProjectRecord(database: ProjectDatabase, projectId: string): boolean {
  return findProjectRecord(database, projectId) !== undefined;
}

/**
 * A copy of the records ordered by their natural key (the project slug),
 * code-unit ascending — the module's one deterministic record order.
 *
 * Stable and immutable: equal keys keep their input order and the input list
 * is never mutated.
 */
export function sortProjectRecords(records: readonly ProjectRecord[]): ProjectRecord[] {
  return [...records].sort((a, b) => {
    const ka = projectRecordKey(a);
    const kb = projectRecordKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}
