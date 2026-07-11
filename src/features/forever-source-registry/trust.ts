/**
 * Forever Source Registry — trust-level models.
 *
 * A {@link SourceTrustLevel} declares how much a source's facts can be relied on
 * — an ordinal graded from `unverified` up to `authoritative`. RC3.3 verifies
 * nothing; it defines the ladder so a future runtime and validation can reason
 * about whether a source clears a required trust bar.
 *
 * Kept as a distinct ordinal from the RC3.0 `VerificationStatus` because trust
 * here is a graded precedence, not a binary verification state — the two answer
 * different questions and must not be conflated.
 */

/** How reliable a source's facts are, from least to most trusted. */
export type SourceTrustLevel = "unverified" | "low" | "standard" | "high" | "authoritative";

/** Every {@link SourceTrustLevel}, least trusted first. */
export const SOURCE_TRUST_LEVELS = [
  "unverified",
  "low",
  "standard",
  "high",
  "authoritative",
] as const satisfies readonly SourceTrustLevel[];

/** Rank of each trust level; a higher number is more trusted. */
const SOURCE_TRUST_RANK: Record<SourceTrustLevel, number> = {
  unverified: 0,
  low: 1,
  standard: 2,
  high: 3,
  authoritative: 4,
};

/** The rank of a trust level; higher means more trusted. */
export function sourceTrustRank(level: SourceTrustLevel): number {
  return SOURCE_TRUST_RANK[level];
}

/** Whether `actual` meets or exceeds a `required` trust level. */
export function meetsTrustLevel(actual: SourceTrustLevel, required: SourceTrustLevel): boolean {
  return SOURCE_TRUST_RANK[actual] >= SOURCE_TRUST_RANK[required];
}

/**
 * Comparator ordering trust levels most-trusted first.
 *
 * Suitable for `Array.prototype.sort`: negative when `a` is more trusted than
 * `b`. Pure and total.
 */
export function compareSourceTrust(a: SourceTrustLevel, b: SourceTrustLevel): number {
  return SOURCE_TRUST_RANK[b] - SOURCE_TRUST_RANK[a];
}

/** Runtime guard: whether a value is a known {@link SourceTrustLevel}. */
export function isKnownSourceTrustLevel(value: unknown): value is SourceTrustLevel {
  return typeof value === "string" && (SOURCE_TRUST_LEVELS as readonly string[]).includes(value);
}
