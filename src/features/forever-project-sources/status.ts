/**
 * Forever Project Sources — source status.
 *
 * A {@link ProjectSourceStatus} records where one catalogued document currently
 * stands in the registry: freshly registered, awaiting review, verified,
 * superseded by a newer version, archived, or rejected. It is a *document
 * standing*, deliberately distinct from the RC3.3 source-system status
 * (`draft`/`enabled`/…) and lifecycle (`proposed`/`active`/…), which describe
 * the *system* a document arrived through — the two answer different questions
 * and must not be conflated.
 *
 * RC4.4 transitions nothing: it defines the vocabulary and pure predicates so
 * validation and a future intake runtime can reason about a document's
 * standing. Timestamped transitions live in the caller-supplied
 * {@link import("./history").ProjectSourceHistory}.
 */

/** Where one catalogued document currently stands. */
export type ProjectSourceStatus =
  | "registered"
  | "pending_review"
  | "verified"
  | "superseded"
  | "archived"
  | "rejected";

/** Every {@link ProjectSourceStatus}, in a stable declared order. */
export const PROJECT_SOURCE_STATUSES = [
  "registered",
  "pending_review",
  "verified",
  "superseded",
  "archived",
  "rejected",
] as const satisfies readonly ProjectSourceStatus[];

/** The statuses a document does not come back from within the registry. */
export const PROJECT_SOURCE_TERMINAL_STATUSES = [
  "superseded",
  "archived",
  "rejected",
] as const satisfies readonly ProjectSourceStatus[];

/**
 * Whether a status marks a document as current — still the standing revision
 * of its document, rather than superseded, archived, or rejected.
 */
export function isCurrentProjectSourceStatus(status: ProjectSourceStatus): boolean {
  return !(PROJECT_SOURCE_TERMINAL_STATUSES as readonly ProjectSourceStatus[]).includes(status);
}

/** Whether a status is terminal: the document does not come back from it. */
export function isTerminalProjectSourceStatus(status: ProjectSourceStatus): boolean {
  return (PROJECT_SOURCE_TERMINAL_STATUSES as readonly ProjectSourceStatus[]).includes(status);
}

/** Runtime guard: whether a value is a known {@link ProjectSourceStatus}. */
export function isKnownProjectSourceStatus(value: unknown): value is ProjectSourceStatus {
  return (
    typeof value === "string" && (PROJECT_SOURCE_STATUSES as readonly string[]).includes(value)
  );
}
