/**
 * Forever Cross-Source Validation — versions.
 *
 * The *source* version every reading pins is the RC4.4
 * {@link import("@/features/forever-project-sources").ProjectSourceVersion}
 * itself (the reused RC3.3 semantic-version shape), carried through the RC4.5
 * `ExtractionSourceVersion` alias — the same shape every fact already carries,
 * reused wholesale rather than restated. One version shape, one formatter, and
 * one comparison rule across the whole source-extraction-validation family,
 * and nothing to drift out of sync.
 *
 * RC4.7 compares versions purely — it never reads a clock to stamp one — and
 * it compares them *totally*: {@link isWellFormedCrossValidationSourceVersion}
 * guards the reused numeric comparison so a malformed revision on a malformed
 * fact is set aside from staleness judgement (and reported by validation)
 * instead of poisoning an ordering with `NaN`.
 */

import type { ExtractionSourceVersion } from "@/features/forever-extraction-pipeline";
import { compareExtractionVersion } from "@/features/forever-extraction-pipeline";

/**
 * The catalogued source revision a reading was extracted from. The RC4.5
 * alias of the RC4.4/RC3.3 shape, re-exported under a cross-validation name
 * so signatures say which revision they pin — never a parallel version
 * scheme.
 */
export type CrossValidationSourceVersion = ExtractionSourceVersion;

// Reuse the RC4.5 formatter and comparator (themselves the RC4.4/RC3.3 ones)
// under cross-validation names — one version implementation across the whole
// source-extraction-validation family.
export {
  formatExtractionVersion as formatCrossValidationSourceVersion,
  compareExtractionVersion as compareCrossValidationSourceVersion,
} from "@/features/forever-extraction-pipeline";

// Reuse the RC4.4 latest-picker under a cross-validation name — the same
// "highest revision, earliest occurrence on ties" rule the source registry
// speaks.
export { latestProjectSourceVersion as latestCrossValidationSourceVersion } from "@/features/forever-project-sources";

/**
 * Runtime guard: whether a value is a structurally well-formed
 * {@link CrossValidationSourceVersion} — an object with finite numeric
 * `major`/`minor`/`patch` parts.
 *
 * The reused numeric comparison is only meaningful between two well-formed
 * versions; this guard is what lets RC4.7 stay total over deeply malformed
 * facts: a revision that cannot be compared is set aside from staleness
 * judgement, never arithmetic-ed into `NaN`.
 */
export function isWellFormedCrossValidationSourceVersion(
  value: unknown,
): value is CrossValidationSourceVersion {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CrossValidationSourceVersion>;
  return (
    typeof candidate.major === "number" &&
    Number.isFinite(candidate.major) &&
    typeof candidate.minor === "number" &&
    Number.isFinite(candidate.minor) &&
    typeof candidate.patch === "number" &&
    Number.isFinite(candidate.patch)
  );
}

/**
 * Total comparator over possibly malformed source versions: two well-formed
 * versions compare through the reused RC4.4/RC3.3 numeric rule, and any
 * malformed side compares equal (`0`) so orderings fall through to their next
 * deterministic tier instead of becoming `NaN`-unstable. Judging the
 * malformed side is validation's job — this comparator only keeps orderings
 * total.
 */
export function compareCrossValidationSourceVersionTotal(a: unknown, b: unknown): number {
  if (isWellFormedCrossValidationSourceVersion(a) && isWellFormedCrossValidationSourceVersion(b)) {
    return compareExtractionVersion(a, b);
  }
  return 0;
}
