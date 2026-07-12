/**
 * Forever Canonical Project Database — deterministic, immutable helpers.
 *
 * Pure, side-effect-free utilities shared across the foundation: stable
 * natural keys for identities and records, field lookups and structural
 * counters, distinct collectors over the module's vocabularies, section
 * grouping, and the module's one deterministic ordering for fields,
 * revisions, and snapshots. Given the same input they always return the same
 * output — no randomness, no clocks, no locale — so the whole module stays
 * deterministic and these helpers never need re-implementing per call site.
 *
 * The string and absence guards are reused verbatim from the Forever
 * Extraction Pipeline (RC4.5) helpers (themselves the RC4.4 ones) rather than
 * restated, so RC4.6 shares one definition of "non-empty string" and "absent"
 * with the extraction machinery it also reuses, and the stats combiners are
 * the RC4.0 ones under canonical-database names.
 */

import { isAbsent, isNonEmptyString } from "@/features/forever-extraction-pipeline";

import type { ProjectField } from "./field";
import { currentProjectFieldValue } from "./field";
import type { ProjectRecordIdentity } from "./identity";
import type { ProjectRecord } from "./record";
import type { ProjectRevision } from "./revision";
import type { ProjectSnapshot } from "./snapshot";
import type { ProjectSectionKey } from "./section";
import {
  PROJECT_SECTION_KEYS,
  compareProjectSections,
  isKnownProjectSectionKey,
  projectSectionRank,
} from "./section";
import type { ProjectSourceRef } from "./types";

export { isAbsent, isNonEmptyString };

// Reuse the RC4.0 stats combiners under canonical-database names — the stats
// shape is the RC4.0 one, so the arithmetic is too.
export {
  mergeProjectIntegrationStats as mergeProjectDatabaseStats,
  sumProjectIntegrationStats as sumProjectDatabaseStats,
} from "@/features/forever-project-integration";

/**
 * Stable key for a record identity, independent of its surrogate id: the
 * normalized slug. Two identities under the same slug share a key.
 */
export function projectRecordIdentityKey(identity: ProjectRecordIdentity): string {
  return identity.slug;
}

/** Stable natural key for a record, derived from its identity. */
export function projectRecordKey(record: ProjectRecord): string {
  return projectRecordIdentityKey(record.identity);
}

/**
 * Stable natural key for a field, independent of its surrogate id: its
 * canonical path. Two fields at the same path describe the same statement.
 */
export function projectFieldKey(field: ProjectField): string {
  return field.path;
}

/** The number of canonical fields a record declares. */
export function projectFieldCount(record: ProjectRecord): number {
  return record.fields.length;
}

/** The number of revisions in a record's history. */
export function projectRevisionCount(record: ProjectRecord): number {
  return record.revisions.length;
}

/** The number of snapshots in a record's history. */
export function projectSnapshotCount(record: ProjectRecord): number {
  return record.snapshots.length;
}

/** The field of a record at a canonical path, or `undefined`. */
export function findProjectField(record: ProjectRecord, path: string): ProjectField | undefined {
  return record.fields.find((field) => field.path === path);
}

/** Every field of a record organized under one canonical section, in input order. */
export function listProjectFieldsBySection(
  fields: readonly ProjectField[],
  section: ProjectSectionKey,
): ProjectField[] {
  return fields.filter((field) => field.section === section);
}

/** Every field whose history holds a standing current value, in input order. */
export function listCurrentProjectFields(fields: readonly ProjectField[]): ProjectField[] {
  return fields.filter((field) => currentProjectFieldValue(field) !== undefined);
}

/**
 * Every field with no standing current value — nothing yet settled, or the
 * value was removed or is explicitly missing — in input order.
 */
export function listUnsettledProjectFields(fields: readonly ProjectField[]): ProjectField[] {
  return fields.filter((field) => currentProjectFieldValue(field) === undefined);
}

/** The distinct canonical sections across fields, in canonical section order. */
export function distinctProjectSections(fields: readonly ProjectField[]): ProjectSectionKey[] {
  const seen = new Set<ProjectSectionKey>();
  for (const field of fields) {
    seen.add(field.section);
  }
  return [...seen].sort(compareProjectSections);
}

/** The distinct RC4.4 sources a record's values trace to, in first-seen order. */
export function distinctProjectSourceRefs(record: ProjectRecord): ProjectSourceRef[] {
  const seen = new Set<ProjectSourceRef>();
  const refs: ProjectSourceRef[] = [];
  const add = (id: ProjectSourceRef) => {
    if (!seen.has(id)) {
      seen.add(id);
      refs.push(id);
    }
  };
  for (const id of record.sourceIds ?? []) add(id);
  for (const field of record.fields) {
    for (const value of field.values) {
      for (const id of value.sourceIds ?? []) add(id);
    }
  }
  return refs;
}

/** One canonical section and every field organized under it. */
export interface ProjectFieldGroup {
  section: ProjectSectionKey;
  /** Every field of the section, in input order. */
  fields: ProjectField[];
}

/**
 * Group fields by canonical section, in canonical section order.
 *
 * Pure and immutable: the input list is never mutated and each group keeps
 * its fields in input order. Only sections that actually hold a field appear
 * — an empty section is not fabricated into the grouping.
 */
export function groupProjectFieldsBySection(fields: readonly ProjectField[]): ProjectFieldGroup[] {
  const groups = new Map<ProjectSectionKey, ProjectFieldGroup>();
  for (const field of fields) {
    let group = groups.get(field.section);
    if (group === undefined) {
      group = { section: field.section, fields: [] };
      groups.set(field.section, group);
    }
    group.fields.push(field);
  }
  return [...groups.values()].sort((a, b) => compareProjectSections(a.section, b.section));
}

/**
 * Pure, locale-independent code-unit string comparison, so the module's
 * ordering never bends to the host's default locale or ICU data.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic sort rank of one field: the canonical rank of its section,
 * with a malformed or unrecognised field ranked after every canonical
 * section — ordered, never dereferenced into a throw (validation reports it).
 */
function projectFieldSortRank(field: ProjectField): number {
  return isKnownProjectSectionKey(field?.section)
    ? projectSectionRank(field.section)
    : PROJECT_SECTION_KEYS.length;
}

/**
 * A copy of the fields in the module's one deterministic order: by canonical
 * section rank, then path, then field id.
 *
 * Stable and immutable: fully tied fields keep their input order and the
 * input list is never mutated. String tiers compare by code unit — no locale.
 * Total: a malformed field sorts after every canonical section instead of
 * throwing.
 */
export function sortProjectFields(fields: readonly ProjectField[]): ProjectField[] {
  return [...fields].sort(
    (a, b) =>
      projectFieldSortRank(a) - projectFieldSortRank(b) ||
      compareStrings(String(a?.path ?? ""), String(b?.path ?? "")) ||
      compareStrings(String(a?.id ?? ""), String(b?.id ?? "")),
  );
}

/**
 * A copy of the revisions ordered by ascending sequence number.
 *
 * Stable and immutable: equal numbers keep their input order and the input
 * list is never mutated.
 */
export function sortProjectRevisions(revisions: readonly ProjectRevision[]): ProjectRevision[] {
  return [...revisions].sort((a, b) => a.number - b.number);
}

/**
 * A copy of the snapshots ordered by ascending frozen revision number, then
 * snapshot id.
 *
 * Stable and immutable: fully tied snapshots keep their input order and the
 * input list is never mutated.
 */
export function sortProjectSnapshots(snapshots: readonly ProjectSnapshot[]): ProjectSnapshot[] {
  return [...snapshots].sort(
    (a, b) => a.revisionNumber - b.revisionNumber || compareStrings(a.id, b.id),
  );
}

/** The revision with the highest sequence number, or `undefined`. Total: a
 * malformed history simply holds no latest revision. */
export function latestProjectRevision(record: ProjectRecord): ProjectRevision | undefined {
  let latest: ProjectRevision | undefined;
  if (!Array.isArray(record?.revisions)) return undefined;
  for (const revision of record.revisions) {
    if (revision == null || typeof revision.number !== "number") continue;
    if (latest === undefined || revision.number > latest.number) {
      latest = revision;
    }
  }
  return latest;
}

/**
 * The sequence number the record's next revision would take: one past the
 * highest recorded, and 1 for a record with no revision yet.
 */
export function nextProjectRevisionNumber(record: ProjectRecord): number {
  const latest = latestProjectRevision(record);
  return latest === undefined ? 1 : latest.number + 1;
}
