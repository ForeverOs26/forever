/**
 * Forever Knowledge Graph — versions.
 *
 * The *source* version a graph reference pins is the RC4.4
 * {@link import("@/features/forever-project-sources").ProjectSourceVersion}
 * itself (the reused RC3.3 semantic-version shape), carried through the RC4.5
 * `ExtractionSourceVersion` alias — the same shape every fact already carries,
 * reused wholesale rather than restated. One version shape, one formatter, and
 * one comparison rule across the whole source-extraction-validation-graph
 * family, and nothing to drift out of sync.
 *
 * RC4.8 compares versions purely — it never reads a clock to stamp one — and
 * it compares them *totally*: the reused RC4.7 well-formedness guard sets a
 * malformed revision aside from ordering (and validation reports it) instead
 * of poisoning an ordering with `NaN`.
 */

import type { ExtractionSourceVersion } from "@/features/forever-extraction-pipeline";

/**
 * The catalogued source revision a graph reference pins. The RC4.5 alias of
 * the RC4.4/RC3.3 shape, re-exported under a knowledge-graph name so refs say
 * which revision they pin — never a parallel version scheme.
 */
export type KnowledgeSourceVersion = ExtractionSourceVersion;

// Reuse the RC4.5 formatter and comparator (themselves the RC4.4/RC3.3 ones)
// under knowledge-graph names — one version implementation across the whole
// family.
export {
  formatExtractionVersion as formatKnowledgeSourceVersion,
  compareExtractionVersion as compareKnowledgeSourceVersion,
} from "@/features/forever-extraction-pipeline";

// Reuse the RC4.7 well-formedness guard and total comparator — the very
// functions the cross-source examination stays total with — under
// knowledge-graph names, never a local restatement.
export {
  isWellFormedCrossValidationSourceVersion as isWellFormedKnowledgeSourceVersion,
  compareCrossValidationSourceVersionTotal as compareKnowledgeSourceVersionTotal,
} from "@/features/forever-cross-validation";
