/**
 * Forever Extraction Pipeline — versions.
 *
 * An {@link ExtractionVersion} records which revision of an extraction
 * definition a descriptor describes, and the *source* version every fact and
 * plan pins is the RC4.4 {@link ProjectSourceVersion} itself — the same reused
 * RC3.3 semantic-version shape in both roles, reused wholesale rather than
 * restated. One version shape, one formatter, and one comparison rule across
 * the whole source-and-extraction family, and nothing to drift out of sync.
 * RC4.5 compares versions purely; it never reads a clock to stamp one.
 */

import type { ProjectSourceVersion } from "@/features/forever-project-sources";

/** The revision of an extraction definition. Reuses the RC4.4/RC3.3 shape. */
export type ExtractionVersion = ProjectSourceVersion;

/**
 * The catalogued source revision a fact or plan was extracted from. The RC4.4
 * shape re-exported under an extraction-facing name so signatures say which
 * revision they pin — never a parallel version scheme.
 */
export type ExtractionSourceVersion = ProjectSourceVersion;

// Reuse the RC4.4 constructor, formatter, and comparator (themselves the
// RC3.3 ones) under extraction names — one version implementation across the
// whole source-and-extraction family.
export {
  projectSourceVersion as extractionVersion,
  formatProjectSourceVersion as formatExtractionVersion,
  compareProjectSourceVersion as compareExtractionVersion,
} from "@/features/forever-project-sources";
