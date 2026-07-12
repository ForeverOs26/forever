/**
 * Forever Canonical Project Database — the described change.
 *
 * A {@link ProjectChange} is one statement of what a revision would do to one
 * canonical field: add a first value, update the standing one (superseding
 * it), remove it (an explicit stated absence), leave it unchanged, or reject
 * an incoming reading outright. A change *describes* — it is data inside a
 * {@link import("./revision").ProjectRevision}, never an operation: RC4.6
 * applies nothing, and the record a change was described against is never
 * touched by describing it.
 *
 * The `before`/`after` values are canonical {@link ProjectFieldValue} entries
 * kept verbatim, so a change is auditable on its own: what stood, what would
 * stand, and which RC4.5 fact the movement traces to.
 */

import type { ProjectFactId, ProjectFieldId } from "./types";
import type { ProjectFieldValue } from "./value";

/** What one described change would do to one canonical field. */
export type ProjectChangeKind = "added" | "updated" | "removed" | "unchanged" | "rejected";

/** Every {@link ProjectChangeKind}, in a stable declared order. */
export const PROJECT_CHANGE_KINDS = [
  "added",
  "updated",
  "removed",
  "unchanged",
  "rejected",
] as const satisfies readonly ProjectChangeKind[];

/** Runtime guard: whether a value is a known {@link ProjectChangeKind}. */
export function isKnownProjectChangeKind(value: unknown): value is ProjectChangeKind {
  return typeof value === "string" && (PROJECT_CHANGE_KINDS as readonly string[]).includes(value);
}

/** One described movement of one canonical field. */
export interface ProjectChange {
  kind: ProjectChangeKind;
  /** Dotted canonical path of the field the change addresses. */
  path: string;
  /** The field's id, when the field already exists or the id was derived. */
  fieldId?: ProjectFieldId;
  /** The value that stood before, when one did. Kept verbatim. */
  before?: ProjectFieldValue;
  /** The value that would stand after, when one would. Kept verbatim. */
  after?: ProjectFieldValue;
  /** The RC4.5 extracted fact the movement traces to, when one drove it. */
  factId?: ProjectFactId;
  /** Free-text note — e.g. why a reading was rejected. */
  note?: string;
}

/** Options accepted by {@link projectChange}. */
export interface ProjectChangeOptions {
  fieldId?: ProjectFieldId;
  before?: ProjectFieldValue;
  after?: ProjectFieldValue;
  factId?: ProjectFactId;
  note?: string;
}

/**
 * Build a {@link ProjectChange}; optional facts are attached only when
 * supplied so an absent fact stays absent (anti-fabrication).
 */
export function projectChange(
  kind: ProjectChangeKind,
  path: string,
  options: ProjectChangeOptions = {},
): ProjectChange {
  const change: ProjectChange = { kind, path };
  if (options.fieldId !== undefined) change.fieldId = options.fieldId;
  if (options.before !== undefined) change.before = options.before;
  if (options.after !== undefined) change.after = options.after;
  if (options.factId !== undefined) change.factId = options.factId;
  if (options.note !== undefined) change.note = options.note;
  return change;
}

/** Whether a change kind describes a movement a revision would apply. */
export function projectChangeKindApplies(kind: ProjectChangeKind): boolean {
  return kind === "added" || kind === "updated" || kind === "removed";
}
