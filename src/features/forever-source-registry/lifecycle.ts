/**
 * Forever Source Registry — lifecycle and status enumerations.
 *
 * Two closed vocabularies that answer different questions about a source:
 * {@link SourceLifecycle} is the long-term *stage* of a source in the roadmap
 * (from `proposed` to `retired`); {@link SourceStatus} is its current
 * *operational* state within the registry (from `draft` to `blocked`).
 *
 * These are types and small pure predicates only. RC3.3 never transitions a
 * lifecycle or status at runtime, runs a scheduler, or enables a source; it
 * defines the vocabulary a future runtime will move a source through.
 */

/**
 * The roadmap stage of a source.
 *
 * `proposed`/`planned` are pre-adoption, `active` is in use, and
 * `deprecated`/`retired` are wind-down stages. Only `retired` is terminal.
 */
export type SourceLifecycle = "proposed" | "planned" | "active" | "deprecated" | "retired";

/** Every {@link SourceLifecycle}, in stage order. */
export const SOURCE_LIFECYCLES = [
  "proposed",
  "planned",
  "active",
  "deprecated",
  "retired",
] as const satisfies readonly SourceLifecycle[];

/** The terminal lifecycle stages a source can settle into. */
export const SOURCE_TERMINAL_LIFECYCLES = ["retired"] as const satisfies readonly SourceLifecycle[];

/** Whether a source is currently in active use. */
export function isActiveLifecycle(lifecycle: SourceLifecycle): boolean {
  return lifecycle === "active";
}

/** Whether a lifecycle stage is terminal (the source is retired). */
export function isTerminalLifecycle(lifecycle: SourceLifecycle): boolean {
  return (SOURCE_TERMINAL_LIFECYCLES as readonly SourceLifecycle[]).includes(lifecycle);
}

/**
 * The operational state of a registered source.
 *
 * `draft` is not yet usable, `enabled` is usable, `experimental` is usable with
 * caution, `disabled` is switched off, and `blocked` is withheld by a policy or
 * unresolved blocker.
 */
export type SourceStatus = "draft" | "enabled" | "experimental" | "disabled" | "blocked";

/** Every {@link SourceStatus}, in a stable declared order. */
export const SOURCE_STATUSES = [
  "draft",
  "enabled",
  "experimental",
  "disabled",
  "blocked",
] as const satisfies readonly SourceStatus[];

/** Whether a status means the source may be used (enabled or experimental). */
export function isUsableStatus(status: SourceStatus): boolean {
  return status === "enabled" || status === "experimental";
}

/** Whether a status means the source is withheld by a policy or blocker. */
export function isBlockedStatus(status: SourceStatus): boolean {
  return status === "blocked";
}

/** Runtime guard: whether a value is a known {@link SourceLifecycle}. */
export function isKnownSourceLifecycle(value: unknown): value is SourceLifecycle {
  return typeof value === "string" && (SOURCE_LIFECYCLES as readonly string[]).includes(value);
}

/** Runtime guard: whether a value is a known {@link SourceStatus}. */
export function isKnownSourceStatus(value: unknown): value is SourceStatus {
  return typeof value === "string" && (SOURCE_STATUSES as readonly string[]).includes(value);
}
