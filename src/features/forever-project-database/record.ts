/**
 * Forever Canonical Project Database — the canonical record.
 *
 * A {@link ProjectRecord} is the one canonical database object a project has:
 * its reused identity, the version of the canonical shape it describes, its
 * standing, its canonical fields organized by section, its append-only
 * revision and snapshot histories, its audit timeline, and the RC4.4 sources
 * that feed it. Every project has exactly one — the record *is* the single
 * source of truth the Forever Website, Intelligence, Passport, Advisory,
 * Search, Compare, Recommendation Engine, and AI Advisor will read from —
 * and the database validation flags any project described twice.
 *
 * {@link describeProjectRecord} is the deterministic entry point that builds
 * a record from what the caller can prove. It is pure — no clock, no shared
 * state — so every call with equal input returns an equal, independent value.
 * It never invents anything: unsupplied fields, revisions, and snapshots stay
 * empty, the timeline starts empty, the standing defaults to the stated safe
 * posture (`draft` — described, not yet published), and the version is the
 * caller's statement, required rather than fabricated. The result is
 * deep-copied, so a record never aliases its input (anti-aliasing).
 */

import type { ProjectField } from "./field";
import type { ProjectRecordIdentity } from "./identity";
import { deriveProjectRecordIdentity } from "./identity";
import type { ProjectRevision } from "./revision";
import type { ProjectSnapshot } from "./snapshot";
import type { ProjectRecordStatus } from "./status";
import type { ProjectTimeline } from "./timeline";
import { emptyProjectTimeline } from "./timeline";
import type { ProjectDatabaseIssue, ProjectDatabaseMetadata, ProjectSourceRef } from "./types";
import type { ProjectRecordVersion } from "./version";

/** The one canonical database object of one Forever project. */
export interface ProjectRecord {
  /** The stable identity of the record — and of the project it canonicalizes. */
  identity: ProjectRecordIdentity;
  /** The revision of the canonical record shape described. Reused shape. */
  version: ProjectRecordVersion;
  /** Where the whole record currently stands. */
  status: ProjectRecordStatus;
  /** The canonical fields, each carrying its own value history. */
  fields: ProjectField[];
  /** The append-only revision history, ascending by sequence number. */
  revisions: ProjectRevision[];
  /** The append-only snapshot history, in the order snapshots were taken. */
  snapshots: ProjectSnapshot[];
  /** The record's own audit trail. */
  timeline: ProjectTimeline;
  /** The RC4.4 catalogued sources feeding this record, in declared order. */
  sourceIds?: ProjectSourceRef[];
  /** Descriptive metadata. Reused RC4.5/RC4.4/RC3.3 shape. */
  metadata?: ProjectDatabaseMetadata;
  /**
   * Structured issues recorded against the record — warnings and errors both
   * live here and partition by the reused RC3.3 severity rule.
   */
  issues?: ProjectDatabaseIssue[];
}

/** The observations {@link describeProjectRecord} builds a record from. */
export interface DescribeProjectRecordInput {
  /** The verified slug of the project the record canonicalizes. */
  projectSlug: string;
  /** Display name; defaults to the normalized slug when omitted. */
  name?: string;
  /** The revision of the canonical record shape. The caller's statement. */
  version: ProjectRecordVersion;
  /** Standing; defaults to `draft` — described, not yet published. */
  status?: ProjectRecordStatus;
  /** The canonical fields; defaults to none. */
  fields?: ProjectField[];
  /** The revision history, ascending by number; defaults to none. */
  revisions?: ProjectRevision[];
  /** The snapshot history; defaults to none. */
  snapshots?: ProjectSnapshot[];
  /** The audit trail; defaults to an empty timeline. */
  timeline?: ProjectTimeline;
  sourceIds?: ProjectSourceRef[];
  metadata?: ProjectDatabaseMetadata;
  issues?: ProjectDatabaseIssue[];
}

/**
 * Describe one canonical project record deterministically from the
 * observations the caller can prove.
 *
 * Pure and total: the same input always yields a byte-identical record. The
 * identity derives through the module's own naming rule and the reused RC4.2
 * `proj_` convention, every optional observation is attached only when
 * supplied, and no field, revision, snapshot, or timestamp is ever invented.
 * The result is deep-copied from the input, so it never aliases a caller
 * value: mutating a described record can never reach back into the input,
 * and two records described from one input share no state.
 */
export function describeProjectRecord(input: DescribeProjectRecordInput): ProjectRecord {
  const identity = deriveProjectRecordIdentity(input.projectSlug, { name: input.name });
  const record: ProjectRecord = {
    identity,
    version: input.version,
    status: input.status ?? "draft",
    fields: input.fields ?? [],
    revisions: input.revisions ?? [],
    snapshots: input.snapshots ?? [],
    timeline: input.timeline ?? emptyProjectTimeline(identity.projectId),
  };
  if (input.sourceIds !== undefined) record.sourceIds = input.sourceIds;
  if (input.metadata !== undefined) record.metadata = input.metadata;
  if (input.issues !== undefined) record.issues = input.issues;
  // Deep-copy so the described record never aliases the caller's input.
  return structuredClone(record);
}
