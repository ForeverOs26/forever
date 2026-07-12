/**
 * Forever Project Readiness — versions.
 *
 * The *source* version a readiness reference pins is the RC4.4
 * {@link import("@/features/forever-project-sources").ProjectSourceVersion}
 * itself (the reused RC3.3 semantic-version shape), carried through the RC4.5
 * `ExtractionSourceVersion` alias — the same shape every fact and every
 * catalogued document already carry, reused wholesale rather than restated.
 * One version shape, one formatter, and one comparison rule across the whole
 * source-extraction-validation-graph-readiness family, and nothing to drift
 * out of sync.
 *
 * RC4.9 compares versions purely — it never reads a clock to stamp one — and
 * it compares them *totally*: the reused RC4.7 well-formedness guard sets a
 * malformed revision aside from ordering (and validation reports it) instead
 * of poisoning an ordering with `NaN`.
 */

import type { ExtractionSourceVersion } from "@/features/forever-extraction-pipeline";

/**
 * The catalogued source revision a readiness reference pins. The RC4.5 alias
 * of the RC4.4/RC3.3 shape, re-exported under a readiness name so references
 * say which revision they pin — never a parallel version scheme.
 */
export type ReadinessSourceVersion = ExtractionSourceVersion;

// Reuse the RC4.5 formatter and comparator (themselves the RC4.4/RC3.3 ones)
// under readiness names — one version implementation across the whole family.
export {
  formatExtractionVersion as formatReadinessSourceVersion,
  compareExtractionVersion as compareReadinessSourceVersion,
} from "@/features/forever-extraction-pipeline";

// Reuse the RC4.7 well-formedness guard and total comparator — the very
// functions the cross-source examination stays total with — under readiness
// names, never a local restatement.
export {
  isWellFormedCrossValidationSourceVersion as isWellFormedReadinessSourceVersion,
  compareCrossValidationSourceVersionTotal as compareReadinessSourceVersionTotal,
} from "@/features/forever-cross-validation";
