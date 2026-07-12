/**
 * Forever Canonical Project Database — the canonical revision.
 *
 * A {@link ProjectRevision} is one described edit of a project's canonical
 * content: a 1-based sequence number, the revision it is based on, the
 * caller-supplied time it was described, who and why, and the ordered
 * {@link ProjectChange} list saying exactly what would move. Revisions are
 * append-only history: a record's revisions grow strictly by number, each
 * chained to its predecessor, and none is ever rewritten — a correction is a
 * newer revision, never an edit of an older one.
 *
 * {@link describeProjectRevision} is pure and deterministic: the id derives
 * from the project slug and sequence number through the module's own naming
 * rule (so repeated revisions never collide), no clock is read, and the
 * result is deep-copied so it never aliases caller values (anti-aliasing).
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ProjectChange } from "./change";
import { projectDatabaseProjectId, projectRevisionIdFor } from "./identity";

/** One described edit of a project's canonical content. */
export interface ProjectRevision {
  /** Stable surrogate id, e.g. `prev_coralina-r2`. */
  id: string;
  /** Canonical id of the project the revision belongs to, e.g. `proj_coralina`. */
  projectId: string;
  /** 1-based position in the record's append-only revision sequence. */
  number: number;
  /** The id of the revision this one is based on, when it has a predecessor. */
  basedOn?: string;
  /** When the revision was described, supplied by the caller — never a clock read. */
  createdAt?: ISODateTime;
  /** Who described the revision, when stated. */
  author?: string;
  /** Why the revision was described, when stated. */
  reason?: string;
  /** What the revision would do, one described change per touched field. */
  changes: ProjectChange[];
}

/** The observations {@link describeProjectRevision} builds a revision from. */
export interface DescribeProjectRevisionInput {
  /** The verified slug of the project the revision belongs to. */
  projectSlug: string;
  /** 1-based position in the record's revision sequence. */
  number: number;
  /** The id of the revision this one is based on, when it has a predecessor. */
  basedOn?: string;
  /** When the revision was described, supplied by the caller. */
  createdAt?: ISODateTime;
  author?: string;
  reason?: string;
  /** The described changes; defaults to none. */
  changes?: ProjectChange[];
}

/**
 * Describe one canonical revision deterministically from the observations the
 * caller can prove.
 *
 * Pure and total: the same input always yields a byte-identical revision. The
 * id derives from the project slug and sequence number, the project id
 * through the reused RC4.2 `proj_` convention, every optional observation is
 * attached only when supplied, and no timestamp is ever invented. The result
 * is deep-copied from the input, so it never aliases a caller value.
 */
export function describeProjectRevision(input: DescribeProjectRevisionInput): ProjectRevision {
  const revision: ProjectRevision = {
    id: projectRevisionIdFor(input.projectSlug, input.number),
    projectId: projectDatabaseProjectId(input.projectSlug),
    number: input.number,
    changes: input.changes ?? [],
  };
  if (input.basedOn !== undefined) revision.basedOn = input.basedOn;
  if (input.createdAt !== undefined) revision.createdAt = input.createdAt;
  if (input.author !== undefined) revision.author = input.author;
  if (input.reason !== undefined) revision.reason = input.reason;
  // Deep-copy so the described revision never aliases the caller's input.
  return structuredClone(revision);
}
