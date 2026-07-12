/**
 * Forever Canonical Project Database — the canonical field.
 *
 * A {@link ProjectField} is one addressable statement of the canonical
 * record: its id, the project it belongs to, the canonical section it is
 * organized under, its dotted path and display name, and its append-only
 * value history — every reading the field ever settled, oldest first, with
 * at most one standing `current` entry among them. Field history is data,
 * never discarded: a superseded value stays in the history it was superseded
 * in, chained by fact id to what replaced it.
 *
 * {@link describeProjectField} is the deterministic entry point that builds a
 * field from what the caller can prove. It is pure — it reads no clock and
 * holds no shared state, so every call with equal input returns an equal,
 * independent value that is safe to mutate, diff, and validate. It never
 * invents anything: an unsupplied history stays empty, the section defaults
 * to what the path itself declares (the stated `unknown` when it declares
 * nothing — never a guess), and the validation standing defaults to the
 * stated safe posture (`unvalidated`).
 */

import { projectFieldIdFor, projectDatabaseProjectId } from "./identity";
import type { ProjectSectionKey } from "./section";
import { projectSectionForPath } from "./section";
import type { ProjectFieldValidationStatus } from "./status";
import { isCurrentProjectValueStatus } from "./status";
import type { ProjectDatabaseIssue, ProjectFieldId } from "./types";
import type { ProjectConfidence } from "./types";
import type { ProjectFieldValue } from "./value";

/** One canonical field of a project record. */
export interface ProjectField {
  /** Stable surrogate id, e.g. `pfld_coralina-pricing-baseprice`. */
  id: ProjectFieldId;
  /** Canonical id of the project the field belongs to, e.g. `proj_coralina`. */
  projectId: string;
  /** The canonical section the field is organized under. */
  section: ProjectSectionKey;
  /** Dotted canonical path, e.g. `pricing.basePrice`. */
  path: string;
  /** Human-readable display name, e.g. `Base price`. */
  name: string;
  /**
   * The append-only value history, oldest first. At most one entry stands
   * `current`; superseded, removed, missing, and unknown entries coexist as
   * the field's recorded past — never discarded, never resolved here.
   */
  values: ProjectFieldValue[];
  /** What the validation pipeline last concluded about the field. */
  validationStatus: ProjectFieldValidationStatus;
  /**
   * Structured issues recorded against the field — warnings and errors both
   * live here and partition by the reused RC3.3 severity rule.
   */
  issues?: ProjectDatabaseIssue[];
}

/** The observations {@link describeProjectField} builds a field from. */
export interface DescribeProjectFieldInput {
  /** The verified slug of the project the field belongs to. */
  projectSlug: string;
  /** Dotted canonical path, e.g. `pricing.basePrice`. */
  path: string;
  /** Display name; defaults to the path when omitted. */
  name?: string;
  /**
   * The canonical section; defaults to what the path itself declares through
   * {@link projectSectionForPath} — the stated `unknown` when it declares
   * nothing, never a guess.
   */
  section?: ProjectSectionKey;
  /** The value history, oldest first; defaults to empty. */
  values?: ProjectFieldValue[];
  /** Validation standing; defaults to `unvalidated`. */
  validationStatus?: ProjectFieldValidationStatus;
  issues?: ProjectDatabaseIssue[];
}

/**
 * Describe one canonical field deterministically from the observations the
 * caller can prove.
 *
 * Pure and total: the same input always yields a byte-identical field. The id
 * is derived through the module's own naming rule and the project id through
 * the reused RC4.2 `proj_` convention — every optional observation is
 * attached only when supplied, and no value, section, or timestamp is ever
 * invented. The result is deep-copied from the input, so it never aliases a
 * caller value: mutating a described field can never reach back into the
 * input, and two fields described from one input share no state.
 */
export function describeProjectField(input: DescribeProjectFieldInput): ProjectField {
  const field: ProjectField = {
    id: projectFieldIdFor(input.projectSlug, input.path),
    projectId: projectDatabaseProjectId(input.projectSlug),
    section: input.section ?? projectSectionForPath(input.path),
    path: input.path,
    name: input.name ?? input.path,
    values: input.values ?? [],
    validationStatus: input.validationStatus ?? "unvalidated",
  };
  if (input.issues !== undefined) field.issues = input.issues;
  // Deep-copy so the described field never aliases the caller's input.
  return structuredClone(field);
}

/**
 * The standing canonical value of a field: the last entry in its history
 * whose status is `current`, or `undefined` when nothing currently stands —
 * an absent current value stays absent, never synthesized. Total: a
 * malformed history simply holds no standing value, it is never
 * dereferenced into a throw.
 */
export function currentProjectFieldValue(field: ProjectField): ProjectFieldValue | undefined {
  if (!Array.isArray(field?.values)) return undefined;
  for (let index = field.values.length - 1; index >= 0; index -= 1) {
    const value = field.values[index];
    if (value != null && isCurrentProjectValueStatus(value.status)) {
      return value;
    }
  }
  return undefined;
}

/** Every superseded entry of a field's history, oldest first. */
export function supersededProjectFieldValues(field: ProjectField): ProjectFieldValue[] {
  return (Array.isArray(field?.values) ? field.values : []).filter(
    (value) => value?.status === "superseded",
  );
}

/** Every removed entry of a field's history, oldest first. */
export function removedProjectFieldValues(field: ProjectField): ProjectFieldValue[] {
  return (Array.isArray(field?.values) ? field.values : []).filter(
    (value) => value?.status === "removed",
  );
}

/**
 * The confidence of a field's standing value, or `undefined` when nothing
 * currently stands — a field without a current value has no confidence to
 * report, and none is fabricated.
 */
export function projectFieldConfidence(field: ProjectField): ProjectConfidence | undefined {
  return currentProjectFieldValue(field)?.confidence;
}

/**
 * Append an entry to a field's value history, returning a new
 * {@link ProjectField}.
 *
 * Immutable and append-only: the input field is never mutated and history is
 * only ever extended, so identical inputs always yield an equal result and
 * callers can share a field freely. Standing transitions (superseding the
 * previous current entry) are the caller's statement to make — this helper
 * appends exactly what it is given.
 */
export function appendProjectFieldValue(
  field: ProjectField,
  value: ProjectFieldValue,
): ProjectField {
  return { ...field, values: [...field.values, value] };
}
