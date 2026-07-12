/**
 * Forever Cross-Source Validation — deterministic, immutable helpers.
 *
 * Pure, side-effect-free utilities shared across the foundation. Given the
 * same input they always return the same output — no randomness, no clocks,
 * no locale — so the whole module stays deterministic and these helpers never
 * need re-implementing per call site.
 *
 * The string and absence guards are reused verbatim from the Forever
 * Canonical Project Database (RC4.6) helpers (themselves the RC4.5/RC4.4
 * ones) rather than restated, so RC4.7 shares one definition of "non-empty
 * string" and "absent" with the machinery it also reuses, and the stats
 * combiners are the RC4.0 ones under cross-validation names.
 */

import type { ExtractionFact } from "@/features/forever-extraction-pipeline";
import { isAbsent, isNonEmptyString } from "@/features/forever-project-database";

import type { CrossSourceRef } from "./types";

export { isAbsent, isNonEmptyString };

// Reuse the RC4.0 stats combiners (through the RC4.6 re-export — the very
// same functions) under cross-validation names — the stats shape is the
// RC4.0 one, so the arithmetic is too.
export {
  mergeProjectDatabaseStats as mergeCrossValidationStats,
  sumProjectDatabaseStats as sumCrossValidationStats,
} from "@/features/forever-project-database";

/**
 * Pure, locale-independent code-unit string comparison, so the module's
 * ordering never bends to the host's default locale or ICU data. Total: a
 * non-string side is coerced through `String` so a malformed value still
 * orders deterministically (validation reports it; ordering never throws).
 */
export function compareCrossValidationStrings(a: unknown, b: unknown): number {
  const left = typeof a === "string" ? a : String(a ?? "");
  const right = typeof b === "string" ? b : String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The distinct RC4.4 source ids a batch of facts traces to, in first-seen
 * input order. Read defensively: a malformed fact contributes nothing rather
 * than dereferencing into a throw.
 */
export function distinctCrossSourceRefs(facts: readonly ExtractionFact[]): CrossSourceRef[] {
  const seen = new Set<CrossSourceRef>();
  const refs: CrossSourceRef[] = [];
  for (const fact of Array.isArray(facts) ? facts : []) {
    const sourceId = fact?.sourceId;
    if (isNonEmptyString(sourceId) && !seen.has(sourceId)) {
      seen.add(sourceId);
      refs.push(sourceId);
    }
  }
  return refs;
}
