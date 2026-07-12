/**
 * Forever Project Sources — source authority.
 *
 * A {@link ProjectSourceAuthority} declares *who stands behind* a catalogued
 * document and how much its facts can be relied on. The trust ladder *is* the
 * RC3.3 {@link import("@/features/forever-source-registry").SourceTrustLevel},
 * reused wholesale — one graded trust vocabulary, one rank, and one comparison
 * across the whole source family. RC4.4 adds only the authority *kind*: the
 * closed vocabulary of issuers a document can be attributed to.
 *
 * RC4.4 verifies nothing — it describes the attribution so validation and a
 * future intake runtime can reason about whether a document clears a required
 * trust bar. The default trust for each kind is a deterministic mapping, and an
 * unattributed document defaults to `unknown`/`unverified` — the safe posture,
 * never a fabricated confidence.
 */

import {
  compareSourceTrust,
  meetsTrustLevel,
  type SourceTrustLevel,
} from "@/features/forever-source-registry";

/** How reliable a catalogued document's facts are. Reuses the RC3.3 ladder. */
export type ProjectSourceTrustLevel = SourceTrustLevel;

// Reuse the RC3.3 trust ladder and its helpers under project-source names —
// one trust implementation across the whole source family.
export {
  SOURCE_TRUST_LEVELS as PROJECT_SOURCE_TRUST_LEVELS,
  sourceTrustRank as projectSourceTrustRank,
  meetsTrustLevel as meetsProjectSourceTrust,
  compareSourceTrust as compareProjectSourceTrust,
  isKnownSourceTrustLevel as isKnownProjectSourceTrustLevel,
} from "@/features/forever-source-registry";

/**
 * The closed vocabulary of issuers a catalogued document can be attributed to.
 *
 * `"unknown"` explicitly represents an unattributed document so it is
 * described rather than dropped (anti-fabrication).
 */
export type ProjectSourceAuthorityKind =
  | "developer_official"
  | "government"
  | "forever_verified"
  | "agency"
  | "third_party"
  | "unknown";

/** Every {@link ProjectSourceAuthorityKind}, in a stable declared order. */
export const PROJECT_SOURCE_AUTHORITY_KINDS = [
  "developer_official",
  "government",
  "forever_verified",
  "agency",
  "third_party",
  "unknown",
] as const satisfies readonly ProjectSourceAuthorityKind[];

/** Runtime guard: whether a value is a known {@link ProjectSourceAuthorityKind}. */
export function isKnownProjectSourceAuthorityKind(
  value: unknown,
): value is ProjectSourceAuthorityKind {
  return (
    typeof value === "string" &&
    (PROJECT_SOURCE_AUTHORITY_KINDS as readonly string[]).includes(value)
  );
}

/** Deterministic default trust for each authority kind. */
const AUTHORITY_KIND_DEFAULT_TRUST: Record<ProjectSourceAuthorityKind, ProjectSourceTrustLevel> = {
  developer_official: "high",
  government: "authoritative",
  forever_verified: "high",
  agency: "standard",
  third_party: "low",
  unknown: "unverified",
};

/**
 * The default {@link ProjectSourceTrustLevel} for an authority kind.
 *
 * Total and deterministic: every kind maps to exactly one default, so an
 * attribution without an explicit trust always lands on the same rung — and an
 * unattributed document always lands on `unverified`.
 */
export function defaultTrustForProjectSourceAuthorityKind(
  kind: ProjectSourceAuthorityKind,
): ProjectSourceTrustLevel {
  return AUTHORITY_KIND_DEFAULT_TRUST[kind];
}

/** Who stands behind one catalogued document, and how far it can be trusted. */
export interface ProjectSourceAuthority {
  kind: ProjectSourceAuthorityKind;
  trust: ProjectSourceTrustLevel;
  /** Who performed the attribution, when known. Free text, e.g. `Forever intake`. */
  verifiedBy?: string;
}

/** Options accepted by {@link projectSourceAuthority}. */
export interface ProjectSourceAuthorityOptions {
  /** Explicit trust; defaults to the kind's deterministic default when omitted. */
  trust?: ProjectSourceTrustLevel;
  verifiedBy?: string;
}

/**
 * Build a {@link ProjectSourceAuthority}; the trust defaults through the
 * deterministic kind mapping and `verifiedBy` is attached only when supplied
 * (anti-fabrication).
 */
export function projectSourceAuthority(
  kind: ProjectSourceAuthorityKind,
  options: ProjectSourceAuthorityOptions = {},
): ProjectSourceAuthority {
  const authority: ProjectSourceAuthority = {
    kind,
    trust: options.trust ?? defaultTrustForProjectSourceAuthorityKind(kind),
  };
  if (options.verifiedBy !== undefined) authority.verifiedBy = options.verifiedBy;
  return authority;
}

/**
 * Comparator ordering authorities most-trusted first, by their trust rung.
 *
 * Suitable for `Array.prototype.sort`; reuses the RC3.3 trust comparison so
 * authorities and source systems order by the same rule. Pure and total.
 */
export function compareProjectSourceAuthority(
  a: ProjectSourceAuthority,
  b: ProjectSourceAuthority,
): number {
  return compareSourceTrust(a.trust, b.trust);
}

/**
 * Whether an authority meets or exceeds a required trust level. Delegates to
 * the reused RC3.3 {@link meetsTrustLevel} rule — never a local restatement.
 */
export function projectSourceAuthorityMeets(
  authority: ProjectSourceAuthority,
  required: ProjectSourceTrustLevel,
): boolean {
  return meetsTrustLevel(authority.trust, required);
}
