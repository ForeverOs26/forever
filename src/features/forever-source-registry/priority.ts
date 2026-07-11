/**
 * Forever Source Registry — priority models.
 *
 * A {@link SourcePriority} declares how authoritative a source is when several
 * sources describe the same fact — the source-of-truth precedence the Forever
 * Constitution requires. RC3.3 resolves no conflict and merges no record; it
 * only defines the ordering a future runtime would apply.
 *
 * The order is a closed, ranked vocabulary so precedence is deterministic and
 * comparable rather than an ad hoc number scattered across call sites.
 */

/**
 * How much precedence a source's facts carry.
 *
 * `primary` outranks `secondary`, which outranks `fallback`, which outranks
 * `reference` (used for context only, never as the winning value).
 */
export type SourcePriority = "primary" | "secondary" | "fallback" | "reference";

/** Every {@link SourcePriority}, highest precedence first. */
export const SOURCE_PRIORITIES = [
  "primary",
  "secondary",
  "fallback",
  "reference",
] as const satisfies readonly SourcePriority[];

/** Rank of each priority; a lower number is higher precedence. */
const SOURCE_PRIORITY_RANK: Record<SourcePriority, number> = {
  primary: 0,
  secondary: 1,
  fallback: 2,
  reference: 3,
};

/** The rank of a priority; lower means more authoritative. */
export function sourcePriorityRank(priority: SourcePriority): number {
  return SOURCE_PRIORITY_RANK[priority];
}

/**
 * Comparator ordering priorities most-authoritative first.
 *
 * Suitable for `Array.prototype.sort`: negative when `a` outranks `b`. Pure and
 * total — identical inputs always compare identically.
 */
export function compareSourcePriority(a: SourcePriority, b: SourcePriority): number {
  return SOURCE_PRIORITY_RANK[a] - SOURCE_PRIORITY_RANK[b];
}

/** Whether `a` is strictly more authoritative than `b`. */
export function isHigherPriority(a: SourcePriority, b: SourcePriority): boolean {
  return SOURCE_PRIORITY_RANK[a] < SOURCE_PRIORITY_RANK[b];
}

/** Runtime guard: whether a value is a known {@link SourcePriority}. */
export function isKnownSourcePriority(value: unknown): value is SourcePriority {
  return typeof value === "string" && (SOURCE_PRIORITIES as readonly string[]).includes(value);
}
