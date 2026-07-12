/**
 * Forever Canonical Project Database — deterministic merge description.
 *
 * This is the engine of RC4.6: {@link describeProjectMerge} takes the
 * existing canonical record and a batch of incoming RC4.5 extracted facts and
 * *describes* the merge a runtime would perform — which readings are new,
 * which are unchanged, which would supersede or remove a standing value,
 * which are rejected, and which *conflict*. It is a pure function: no clock,
 * no randomness, no IO, no hidden state — identical record, facts, and
 * context always yield an identical description, and the input record and
 * facts are never mutated.
 *
 * A conflict is never resolved: when a reading from a *different* source
 * disagrees with the standing value, both readings are described side by side
 * in a {@link ProjectConflict} and the standing value stays exactly where it
 * was — preferring a source, deriving a winner, or averaging readings stays a
 * future runtime's (or a human's) concern. Only a newer reading from the
 * *same* source is described as superseding its own earlier statement, and an
 * explicit stated absence from the same source is described as a removal —
 * descriptions of what the source itself now says, never a judgement between
 * sources.
 *
 * Facts are considered in input order against a working view that already
 * includes the earlier described movements, so a batch is described the way
 * it would settle — and two disagreeing readings inside one batch surface as
 * a described conflict, unresolved, exactly like readings arriving apart.
 */

import type { ISODateTime } from "@/features/forever-database";
import type { ExtractionFact } from "@/features/forever-extraction-pipeline";

import type { ProjectChange } from "./change";
import { projectChange } from "./change";
import type { ProjectContext } from "./context";
import type { ProjectField } from "./field";
import { currentProjectFieldValue, describeProjectField } from "./field";
import {
  isAbsent,
  isNonEmptyString,
  nextProjectRevisionNumber,
  latestProjectRevision,
  sortProjectFields,
} from "./helpers";
import type { ProjectHistoryEntry } from "./history";
import { projectFieldIdFor, projectMergeIdFor, projectRevisionIdFor } from "./identity";
import type { ProjectRevision } from "./revision";
import { describeProjectRevision } from "./revision";
import { createProjectResult, emptyProjectDatabaseStats } from "./result";
import type { ProjectResult, ProjectRunMetadata, ProjectDatabaseStats } from "./result";
import { isProjectStructuredValue, projectDatabaseError, projectDatabaseWarning } from "./types";
import type { ProjectDatabaseIssue, ProjectFactId, ProjectFieldId, ProjectRecordId } from "./types";
import type { ProjectFieldValue } from "./value";
import { projectFieldValueFromFact, projectFieldValueSignature } from "./value";

/**
 * One incoming RC4.5 extracted fact, reused directly — the merge description
 * consumes the very shape the extraction pipeline produces, never a
 * re-described copy.
 */
export type ProjectIncomingFact = ExtractionFact;

/**
 * The request one merge description is described from.
 *
 * Only `facts` is required — the incoming RC4.5 extracted facts, reused
 * directly. Optional facts are honoured only when supplied so an absent fact
 * stays absent (anti-fabrication): the author and reason appear on the
 * described revision only because a caller stated them.
 */
export interface ProjectRequest {
  /** The incoming extracted facts to describe a merge for, in input order. */
  facts: ProjectIncomingFact[];
  /** Who requested the merge, when stated. */
  author?: string;
  /** Why the merge was requested, when stated. */
  reason?: string;
}

/** How one incoming fact classified against the canonical record. */
export type ProjectMergeEntryKind =
  | "added"
  | "updated"
  | "removed"
  | "unchanged"
  | "conflicting"
  | "rejected";

/** Every {@link ProjectMergeEntryKind}, in a stable declared order. */
export const PROJECT_MERGE_ENTRY_KINDS = [
  "added",
  "updated",
  "removed",
  "unchanged",
  "conflicting",
  "rejected",
] as const satisfies readonly ProjectMergeEntryKind[];

/** Runtime guard: whether a value is a known {@link ProjectMergeEntryKind}. */
export function isKnownProjectMergeEntryKind(value: unknown): value is ProjectMergeEntryKind {
  return (
    typeof value === "string" && (PROJECT_MERGE_ENTRY_KINDS as readonly string[]).includes(value)
  );
}

/** One incoming fact, classified against the canonical record. */
export interface ProjectMergeEntry {
  kind: ProjectMergeEntryKind;
  /** The incoming fact the entry classifies. */
  factId: ProjectFactId;
  /** The canonical path the fact addresses, when it declares one. */
  path?: string;
  /** The canonical field the fact would settle into, when one is addressed. */
  fieldId?: ProjectFieldId;
  /** The canonical value the fact would settle as, when it classified that far. */
  incoming?: ProjectFieldValue;
  /** The standing value the fact met, when one stood. Kept verbatim. */
  existing?: ProjectFieldValue;
  /** Why the fact was rejected, when it was. */
  reason?: string;
}

/**
 * One described disagreement: a reading that contradicts the standing
 * canonical value. Both sides are kept verbatim, side by side — described,
 * never resolved.
 */
export interface ProjectConflict {
  /** The canonical path the disagreement is about. */
  path: string;
  /** The canonical field the disagreement is about. */
  fieldId: ProjectFieldId;
  /** The incoming fact whose reading disagrees. */
  factId: ProjectFactId;
  /** The value that currently stands. Kept verbatim, untouched. */
  existing: ProjectFieldValue;
  /** The disagreeing incoming reading. Kept verbatim, unapplied. */
  incoming: ProjectFieldValue;
  /** When the disagreement was described, supplied by the caller. */
  detectedAt?: ISODateTime;
}

/** The full description of one merge — what would happen, never what did. */
export interface ProjectMerge {
  /** Stable surrogate id, e.g. `pmrg_coralina-r2`. */
  id: string;
  /** Canonical id of the project, e.g. `proj_coralina`. */
  projectId: string;
  /** The canonical record the merge was described against. */
  recordId: ProjectRecordId;
  /** The revision the merge describes — described, never applied. */
  revision: ProjectRevision;
  /** Every incoming fact classified, in input order. */
  entries: ProjectMergeEntry[];
  /** Every described disagreement, in input order. Unresolved by design. */
  conflicts: ProjectConflict[];
  /**
   * The canonical fields as they would stand if the described (non-
   * conflicting) movements settled, deep-copied in the module's one canonical
   * order. Conflicted fields stand exactly as they did — a conflict changes
   * nothing until it is resolved elsewhere.
   */
  mergedFields: ProjectField[];
}

/** Every entry of one kind, in input order. */
export function listProjectMergeEntries(
  merge: ProjectMerge,
  kind: ProjectMergeEntryKind,
): ProjectMergeEntry[] {
  return merge.entries.filter((entry) => entry.kind === kind);
}

function mergeRunMetadata(
  context: ProjectContext,
  counts: { fieldCount: number; factCount: number; conflictCount: number },
  refs: { recordId?: ProjectRecordId; projectId?: string; revisionId?: string; mergeId?: string },
): ProjectRunMetadata {
  const metadata: ProjectRunMetadata = { ...counts };
  if (refs.recordId !== undefined) metadata.recordId = refs.recordId;
  if (refs.projectId !== undefined) metadata.projectId = refs.projectId;
  if (refs.revisionId !== undefined) metadata.revisionId = refs.revisionId;
  if (refs.mergeId !== undefined) metadata.mergeId = refs.mergeId;
  if (context?.now !== undefined) metadata.describedAt = context.now;
  return metadata;
}

/**
 * Whether a fact's reading traces to the same RC4.4 source as a standing
 * value. Judged defensively: a malformed reference list on the standing value
 * can never masquerade as a same-source statement — the doubt classifies as a
 * conflict (described, not resolved), and validation reports the malformed
 * list.
 */
function fromSameSource(incomingFact: ProjectIncomingFact, standing: ProjectFieldValue): boolean {
  if (!isNonEmptyString(incomingFact.sourceId)) return false;
  if (Array.isArray(standing.sourceIds) && standing.sourceIds.includes(incomingFact.sourceId)) {
    return true;
  }
  return standing.provenance?.sourceId === incomingFact.sourceId;
}

/**
 * Describe the merge of incoming extracted facts into a canonical record.
 *
 * Pure and deterministic: it mutates neither the context, the record, nor the
 * facts, performs no IO, and never throws — an absent record, a malformed
 * facts list, or an incoherent fact is reported as issues on the result. Each
 * fact classifies as exactly one {@link ProjectMergeEntry}:
 *
 * - `rejected` — the fact is malformed (no usable id, project, source, or a
 *   representation that cannot be described), repeats an id already
 *   classified in the batch, belongs to another project, declares no
 *   canonical path, or is itself superseded or disputed; recorded with a
 *   reason, never silently dropped.
 * - `added` — nothing stands at the path; the reading (or its explicit
 *   stated absence) would become the field's first history entry.
 * - `unchanged` — the standing value carries a byte-identical representation.
 * - `updated` — a *same-source* reading disagrees with what that source
 *   previously stated; the standing value would be superseded, chained by
 *   fact id, and kept in history.
 * - `removed` — a *same-source* reading explicitly states absence; the
 *   standing value would be marked removed and the stated absence recorded.
 * - `conflicting` — a *different-source* reading disagrees; both readings
 *   are described side by side in a {@link ProjectConflict} and nothing
 *   moves. RC4.6 never resolves a conflict.
 *
 * The returned merge is deep-copied, so it never aliases the record or the
 * facts (anti-aliasing). One deterministic completion rule feeds the reused
 * RC4.0 lifecycle: each applying movement completes, each unchanged or
 * conflicting fact is skipped (described, not applied), and each rejected
 * fact fails.
 */
export function describeProjectMerge(
  context: ProjectContext,
  request: ProjectRequest,
): ProjectResult<ProjectMerge> {
  const record = context?.record;
  if (isAbsent(record) || isAbsent(record.identity) || !isNonEmptyString(record.identity.slug)) {
    const issue = projectDatabaseError(
      "missing_merge_record",
      "Project context names no coherent canonical record to merge into",
      "record",
    );
    return createProjectResult({
      data: [],
      issues: [issue],
      stats: emptyProjectDatabaseStats(),
      metadata: mergeRunMetadata(context, { fieldCount: 0, factCount: 0, conflictCount: 0 }, {}),
    });
  }

  const recordRefs = {
    recordId: record.identity.id,
    projectId: record.identity.projectId,
  };

  if (!Array.isArray(request?.facts)) {
    const issue = projectDatabaseError(
      "invalid_merge_facts",
      "Project request declares a non-list facts value",
      "facts",
    );
    return createProjectResult({
      data: [],
      issues: [issue],
      stats: emptyProjectDatabaseStats(),
      metadata: mergeRunMetadata(
        context,
        { fieldCount: record.fields?.length ?? 0, factCount: 0, conflictCount: 0 },
        recordRefs,
      ),
    });
  }

  const issues: ProjectDatabaseIssue[] = [];
  const revisionNumber = nextProjectRevisionNumber(record);
  const revisionId = projectRevisionIdFor(record.identity.slug, revisionNumber);
  const mergeId = projectMergeIdFor(record.identity.slug, revisionNumber);

  if (!Array.isArray(record.fields)) {
    issues.push(
      projectDatabaseWarning(
        "invalid_record_fields",
        "Record fields are not a list — the merge classifies against no standing field",
        "record.fields",
      ),
    );
  }

  const entries: ProjectMergeEntry[] = [];
  const conflicts: ProjectConflict[] = [];
  const changes: ProjectChange[] = [];
  // The working view facts classify against: the record's fields plus every
  // earlier described movement, so a batch is described the way it would
  // settle. Deep-copied up front — the record itself is never touched — and a
  // record whose fields cannot even be copied (an exotic, uncloneable value)
  // is reported, never thrown out of.
  let working: ProjectField[];
  try {
    working = structuredClone(Array.isArray(record.fields) ? record.fields : []);
  } catch {
    return createProjectResult({
      data: [],
      issues: [
        ...issues,
        projectDatabaseError(
          "uncloneable_record",
          "Record fields hold values that cannot be copied for description",
          "record.fields",
        ),
      ],
      stats: emptyProjectDatabaseStats(),
      metadata: mergeRunMetadata(
        context,
        { fieldCount: 0, factCount: request.facts.length, conflictCount: 0 },
        recordRefs,
      ),
    });
  }

  const reject = (fact: ProjectIncomingFact, index: number, reason: string, blocking: boolean) => {
    const entry: ProjectMergeEntry = {
      kind: "rejected",
      factId: String(fact?.id ?? ""),
      reason,
    };
    if (isNonEmptyString(fact?.fieldPath)) entry.path = fact.fieldPath;
    entries.push(entry);
    changes.push(
      projectChange("rejected", isNonEmptyString(fact?.fieldPath) ? fact.fieldPath : "", {
        ...(isNonEmptyString(fact?.id) ? { factId: fact.id } : {}),
        note: reason,
      }),
    );
    const raise = blocking ? projectDatabaseError : projectDatabaseWarning;
    issues.push(raise("rejected_fact", reason, `facts.${index}`));
  };

  // Iterated by index — never by a hole-skipping iterator — so every slot of
  // the batch classifies as exactly one entry, and a hole rejects as a
  // malformed fact instead of vanishing silently.
  const classified = new Set<ProjectFactId>();
  for (let index = 0; index < request.facts.length; index += 1) {
    const fact = request.facts[index];
    if (
      isAbsent(fact) ||
      !isNonEmptyString(fact.id) ||
      !isNonEmptyString(fact.projectId) ||
      !isNonEmptyString(fact.sourceId)
    ) {
      reject(fact, index, "Incoming fact is malformed: it carries no id, project, or source", true);
      continue;
    }
    if (classified.has(fact.id)) {
      // The validator's rule, enforced at description time: one fact, one
      // classification — a repeated id is rejected, never classified twice.
      reject(fact, index, `Incoming fact "${fact.id}" is already classified in this batch`, true);
      continue;
    }
    classified.add(fact.id);
    if (fact.projectId !== record.identity.projectId) {
      reject(
        fact,
        index,
        `Incoming fact belongs to "${fact.projectId}", not "${record.identity.projectId}"`,
        true,
      );
      continue;
    }
    if (fact.status === "superseded" || fact.status === "disputed") {
      reject(fact, index, `Incoming fact is ${fact.status} and cannot settle as canonical`, false);
      continue;
    }
    if (!isNonEmptyString(fact.fieldPath)) {
      reject(fact, index, "Incoming fact declares no canonical field path to settle into", false);
      continue;
    }
    if (fact.structuredValue !== undefined && !isProjectStructuredValue(fact.structuredValue)) {
      reject(fact, index, "Incoming fact carries a malformed structured value", true);
      continue;
    }

    const path = fact.fieldPath;
    let incoming: ProjectFieldValue;
    try {
      incoming = projectFieldValueFromFact(fact, {
        revisionId,
        ...(context.now === undefined ? {} : { recordedAt: context.now }),
      });
    } catch {
      // An exotic, uncloneable part (in the confidence, evidence, or
      // provenance) cannot settle — reported, never thrown out of.
      reject(fact, index, "Incoming fact could not be described as a canonical value", true);
      continue;
    }
    // Matched and read defensively so a malformed field inside the record is
    // classified around, never dereferenced into a throw.
    const fieldIndex = working.findIndex((field) => field?.path === path);
    const fieldId =
      fieldIndex >= 0 && isNonEmptyString(working[fieldIndex].id)
        ? working[fieldIndex].id
        : projectFieldIdFor(record.identity.slug, path);

    if (fieldIndex < 0) {
      // Nothing is described at the path at all: the reading — or its
      // explicit stated absence — becomes the field's first history entry.
      entries.push({ kind: "added", factId: fact.id, path, fieldId, incoming });
      changes.push(projectChange("added", path, { fieldId, after: incoming, factId: fact.id }));
      working.push(
        describeProjectField({
          projectSlug: record.identity.slug,
          path,
          values: [incoming],
        }),
      );
      continue;
    }

    const field = working[fieldIndex];
    const history = Array.isArray(field.values) ? field.values : [];
    const standing = currentProjectFieldValue(field);

    if (standing === undefined) {
      // The field exists but nothing currently stands: the reading would
      // become the standing value (or record a fresh stated absence).
      entries.push({ kind: "added", factId: fact.id, path, fieldId, incoming });
      changes.push(projectChange("added", path, { fieldId, after: incoming, factId: fact.id }));
      working[fieldIndex] = { ...field, values: [...history, incoming] };
      continue;
    }

    if (projectFieldValueSignature(standing) === projectFieldValueSignature(incoming)) {
      entries.push({ kind: "unchanged", factId: fact.id, path, fieldId, existing: standing });
      changes.push(
        projectChange("unchanged", path, { fieldId, before: standing, factId: fact.id }),
      );
      continue;
    }

    if (fromSameSource(fact, standing)) {
      // The source itself now says something else: its earlier statement
      // would be superseded (or, on a stated absence, removed) — kept in
      // history, chained by fact id, never discarded.
      const removal = incoming.status === "missing";
      const kind = removal ? "removed" : "updated";
      entries.push({ kind, factId: fact.id, path, fieldId, incoming, existing: standing });
      changes.push(
        projectChange(kind, path, { fieldId, before: standing, after: incoming, factId: fact.id }),
      );
      const settled: ProjectFieldValue = {
        ...standing,
        status: removal ? "removed" : "superseded",
        supersededBy: fact.id,
      };
      working[fieldIndex] = {
        ...field,
        values: [...history.map((value) => (value === standing ? settled : value)), incoming],
      };
      continue;
    }

    // A different source disagrees: describe the conflict and move nothing.
    entries.push({
      kind: "conflicting",
      factId: fact.id,
      path,
      fieldId,
      incoming,
      existing: standing,
    });
    const conflict: ProjectConflict = {
      path,
      fieldId,
      factId: fact.id,
      existing: standing,
      incoming,
    };
    if (context.now !== undefined) conflict.detectedAt = context.now;
    conflicts.push(conflict);
    issues.push(
      projectDatabaseWarning(
        "conflicting_values",
        `Incoming fact "${fact.id}" disagrees with the standing value at "${path}" — described, not resolved`,
        `facts.${index}`,
      ),
    );
  }

  const revision = describeProjectRevision({
    projectSlug: record.identity.slug,
    number: revisionNumber,
    ...(latestProjectRevision(record) === undefined
      ? {}
      : { basedOn: latestProjectRevision(record)?.id }),
    ...(context.now === undefined ? {} : { createdAt: context.now }),
    ...(request.author === undefined ? {} : { author: request.author }),
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    changes,
  });

  // The merge is deep-copied at this boundary so a result never aliases the
  // record's or the facts' values: mutating a described merge can never reach
  // back into the canonical record or the caller's facts.
  const merge: ProjectMerge = structuredClone({
    id: mergeId,
    projectId: record.identity.projectId,
    recordId: record.identity.id,
    revision,
    entries,
    conflicts,
    mergedFields: sortProjectFields(working),
  });

  // One deterministic completion rule: each applying movement completes, each
  // unchanged or conflicting fact is skipped (described, not applied), and
  // each rejected fact fails.
  const applied = entries.filter(
    (entry) => entry.kind === "added" || entry.kind === "updated" || entry.kind === "removed",
  ).length;
  const skipped = entries.filter(
    (entry) => entry.kind === "unchanged" || entry.kind === "conflicting",
  ).length;
  const failed = entries.filter((entry) => entry.kind === "rejected").length;
  const stats: ProjectDatabaseStats = {
    ...emptyProjectDatabaseStats(),
    stages: 1,
    steps: request.facts.length,
    completed: applied,
    skipped,
    failed,
  };

  return createProjectResult({
    data: [merge],
    issues,
    stats,
    metadata: mergeRunMetadata(
      context,
      {
        fieldCount: merge.mergedFields.length,
        factCount: request.facts.length,
        conflictCount: conflicts.length,
      },
      { ...recordRefs, revisionId: revision.id, mergeId },
    ),
  });
}

/** Options accepted by {@link projectMergeHistoryEntry}. */
export interface ProjectMergeHistoryOptions {
  /** When the described merge started, supplied by the caller. */
  startedAt?: ISODateTime;
  /** When the described merge finished, supplied by the caller. */
  finishedAt?: ISODateTime;
}

/**
 * Derive the {@link ProjectHistoryEntry} a described merge settles into.
 *
 * Pure glue between {@link describeProjectMerge} and the history model: it
 * copies the result's settled state, outcome, and counters, and attaches the
 * merge and revision references (and caller-supplied timestamps) only when
 * present, so an absent fact stays absent. A merge that never resolved a
 * record carries no project reference, so the entry's required `projectId`
 * is left empty — a stated blank the history validator flags, never an
 * invented project.
 */
export function projectMergeHistoryEntry(
  result: ProjectResult<ProjectMerge>,
  options: ProjectMergeHistoryOptions = {},
): ProjectHistoryEntry {
  const entry: ProjectHistoryEntry = {
    projectId: result.metadata.projectId ?? "",
    state: result.state,
    outcome: result.outcome,
    // Copied, never aliased: mutating a history entry's counters must not
    // reach back into the result it was derived from.
    stats: { ...result.stats },
  };
  if (result.metadata.mergeId !== undefined) entry.mergeId = result.metadata.mergeId;
  if (result.metadata.revisionId !== undefined) entry.revisionId = result.metadata.revisionId;
  if (options.startedAt !== undefined) entry.startedAt = options.startedAt;
  if (options.finishedAt !== undefined) entry.finishedAt = options.finishedAt;
  return entry;
}
