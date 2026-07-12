/**
 * Forever Cross-Source Validation — source authority and independence.
 *
 * Who stands behind a reading is the RC4.4
 * {@link import("@/features/forever-project-sources").ProjectSourceAuthority},
 * reused wholesale — one attribution shape, one trust ladder (the RC3.3 one),
 * one rank, and one comparison across the whole source family. RC4.7 adds
 * only the two lookups cross-source judgement needs: resolving the registered
 * authority a fact's source id traces to, and judging whether two catalogued
 * sources are *independent* — not chained to each other through the RC4.4
 * relationship references (supersession, derivation, translation, relation).
 *
 * RC4.7 attributes nothing itself: a reading from a source the caller did not
 * register simply has no resolved authority — the absence is preserved, never
 * replaced by a fabricated attribution. Independence is likewise judged only
 * from declared relationships: two sources with no declared chain between
 * them are treated as independent because nothing states otherwise, and the
 * declaration-or-nothing rule is itself the stated convention.
 */

import type {
  ProjectSourceAuthority,
  ProjectSourceDefinition,
  ProjectSourceTrustLevel,
} from "@/features/forever-project-sources";
import { listProjectSourceRelationshipTargets } from "@/features/forever-project-sources";

import { isAbsent, isNonEmptyString } from "./helpers";
import type { CrossSourceRef } from "./types";

/** Who stands behind one reading's source. Reuses the RC4.4 shape verbatim. */
export type CrossSourceAuthority = ProjectSourceAuthority;

/** The reused RC3.3 trust ladder, under a cross-validation name. */
export type CrossSourceTrustLevel = ProjectSourceTrustLevel;

// Reuse the RC4.4 authority machinery (itself the RC3.3 trust machinery)
// under cross-validation names — one trust implementation across the whole
// source family, never a local variant.
export {
  PROJECT_SOURCE_TRUST_LEVELS as CROSS_SOURCE_TRUST_LEVELS,
  projectSourceTrustRank as crossSourceTrustRank,
  meetsProjectSourceTrust as meetsCrossSourceTrust,
  compareProjectSourceTrust as compareCrossSourceTrust,
  isKnownProjectSourceTrustLevel as isKnownCrossSourceTrustLevel,
  compareProjectSourceAuthority as compareCrossSourceAuthority,
  isKnownProjectSourceAuthorityKind as isKnownCrossSourceAuthorityKind,
} from "@/features/forever-project-sources";

/**
 * The registered RC4.4 definition a source id resolves to, or `undefined`.
 *
 * Pure and total: the list is scanned defensively (a malformed entry can
 * never dereference into a throw), the first definition whose identity id
 * matches wins — matching the RC4.4 registry's first-registered rule — and an
 * unmatched id stays unresolved rather than being invented.
 */
export function resolveCrossValidationSource(
  sources: readonly ProjectSourceDefinition[] | undefined,
  sourceId: CrossSourceRef,
): ProjectSourceDefinition | undefined {
  if (!Array.isArray(sources) || !isNonEmptyString(sourceId)) return undefined;
  return sources.find((source) => !isAbsent(source) && source.identity?.id === sourceId);
}

/**
 * The registered authority standing behind a source id, or `undefined` when
 * the source is not registered or carries no attribution — the absence is
 * preserved, never replaced by a fabricated authority.
 */
export function resolveCrossSourceAuthority(
  sources: readonly ProjectSourceDefinition[] | undefined,
  sourceId: CrossSourceRef,
): CrossSourceAuthority | undefined {
  const definition = resolveCrossValidationSource(sources, sourceId);
  return isAbsent(definition?.authority) ? undefined : definition.authority;
}

/**
 * Whether two catalogued sources are independent of each other: neither
 * declares the other among its RC4.4 relationship targets (supersession,
 * derivation, translation, or relation — collected through the reused RC4.4
 * {@link listProjectSourceRelationshipTargets}, never a local restatement).
 *
 * A source is never independent of itself. Sources the caller did not
 * register carry no declared relationships, so distinct unregistered ids
 * judge as independent — the declaration-or-nothing rule, stated rather than
 * guessed. Pure and total over malformed definitions.
 */
export function areIndependentCrossSources(
  a: CrossSourceRef,
  b: CrossSourceRef,
  sources?: readonly ProjectSourceDefinition[],
): boolean {
  if (a === b) return false;
  const declaresOther = (from: CrossSourceRef, other: CrossSourceRef): boolean => {
    const definition = resolveCrossValidationSource(sources, from);
    if (isAbsent(definition?.relationships)) return false;
    try {
      return listProjectSourceRelationshipTargets(definition.relationships).includes(other);
    } catch {
      // A deeply malformed relationships value cannot prove a chain; the
      // malformation is validation's finding, not an independence verdict.
      return false;
    }
  };
  return !declaresOther(a, b) && !declaresOther(b, a);
}
