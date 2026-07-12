/**
 * Forever Canonical Project Database — the canonical snapshot.
 *
 * A {@link ProjectSnapshot} freezes what a project's canonical fields looked
 * like at one revision: the revision it pins (by id and number), the
 * caller-supplied time it was taken, and a deep, independent copy of every
 * field in the module's one canonical order. Snapshot history is append-only
 * data — a record accumulates snapshots and never rewrites one, and each
 * revision is snapshotted at most once (a duplicate is flagged by validation,
 * never silently replaced).
 *
 * {@link describeProjectSnapshot} is pure and deterministic: it reads no
 * clock, mutates nothing, and deep-copies the fields it freezes, so a
 * snapshot never aliases the living record (anti-aliasing) — mutating the
 * record later can never reach back into a snapshot already taken.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ProjectField } from "./field";
import { sortProjectFields } from "./helpers";
import { projectSnapshotIdFor } from "./identity";
import type { ProjectRecord } from "./record";
import type { ProjectRevision } from "./revision";

/** One frozen view of a project's canonical fields at one revision. */
export interface ProjectSnapshot {
  /** Stable surrogate id, e.g. `psnap_coralina-r2`. */
  id: string;
  /** Canonical id of the project the snapshot belongs to, e.g. `proj_coralina`. */
  projectId: string;
  /** The revision the snapshot freezes, by id. */
  revisionId: string;
  /** The revision the snapshot freezes, by sequence number. */
  revisionNumber: number;
  /** When the snapshot was taken, supplied by the caller — never a clock read. */
  takenAt?: ISODateTime;
  /** The frozen fields, deep-copied, in the module's one canonical order. */
  fields: ProjectField[];
}

/** Options accepted by {@link describeProjectSnapshot}. */
export interface DescribeProjectSnapshotOptions {
  /** When the snapshot was taken, supplied by the caller. */
  takenAt?: ISODateTime;
}

/**
 * Describe the snapshot of a record's canonical fields at one revision.
 *
 * Pure and deterministic: identical record and revision always yield a
 * byte-identical snapshot. The fields are deep-copied and put in the
 * module's one canonical order (section rank, then path, then id), so the
 * snapshot never aliases the record and never depends on the record's field
 * insertion order. The record itself is never mutated, and no timestamp is
 * invented — `takenAt` appears only when the caller supplies one.
 */
export function describeProjectSnapshot(
  record: ProjectRecord,
  revision: ProjectRevision,
  options: DescribeProjectSnapshotOptions = {},
): ProjectSnapshot {
  const snapshot: ProjectSnapshot = {
    id: projectSnapshotIdFor(record.identity.slug, revision.number),
    projectId: record.identity.projectId,
    revisionId: revision.id,
    revisionNumber: revision.number,
    fields: sortProjectFields(record.fields),
  };
  if (options.takenAt !== undefined) snapshot.takenAt = options.takenAt;
  // Deep-copy so the snapshot never aliases the living record.
  return structuredClone(snapshot);
}

/**
 * Append a snapshot to a record's snapshot history, returning a new
 * {@link ProjectRecord}.
 *
 * Immutable and append-only: the input record is never mutated and history is
 * only ever extended. Whether the snapshot duplicates an existing revision is
 * validation's judgement to report — never silently resolved here.
 */
export function addProjectSnapshot(
  record: ProjectRecord,
  snapshot: ProjectSnapshot,
): ProjectRecord {
  return { ...record, snapshots: [...record.snapshots, snapshot] };
}

/** The most recently appended snapshot, or `undefined` when none was taken. */
export function latestProjectSnapshot(record: ProjectRecord): ProjectSnapshot | undefined {
  return record.snapshots.length > 0 ? record.snapshots[record.snapshots.length - 1] : undefined;
}
