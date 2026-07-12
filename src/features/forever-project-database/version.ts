/**
 * Forever Canonical Project Database — versions.
 *
 * A {@link ProjectRecordVersion} records which revision of the canonical
 * record shape a record describes, and the *source* version a canonical value
 * pins through its reused provenance is the RC4.4 `ProjectSourceVersion`
 * itself — the same reused RC3.3 semantic-version shape in both roles,
 * carried through RC4.5 and reused wholesale rather than restated. One
 * version shape, one formatter, and one comparison rule across the whole
 * source-extraction-database family, and nothing to drift out of sync. RC4.6
 * compares versions purely; it never reads a clock to stamp one.
 *
 * Deliberately distinct from a {@link import("./revision").ProjectRevision}:
 * the version says which *shape* of the canonical record is described, the
 * revision says which *edit* of its content — the two answer different
 * questions and must not be conflated.
 */

import type { ExtractionSourceVersion } from "@/features/forever-extraction-pipeline";

/** The revision of the canonical record shape. Reuses the RC4.5/RC4.4/RC3.3 shape. */
export type ProjectRecordVersion = ExtractionSourceVersion;

/**
 * The catalogued source revision a canonical value traces back to. The RC4.5
 * name re-exported under a canonical-database-facing one so signatures say
 * which revision they pin — never a parallel version scheme.
 */
export type ProjectSourceVersionRef = ExtractionSourceVersion;

// Reuse the RC4.5 constructor, formatter, and comparator (themselves the
// RC4.4/RC3.3 ones) under canonical-database names — one version
// implementation across the whole family.
export {
  extractionVersion as projectRecordVersion,
  formatExtractionVersion as formatProjectRecordVersion,
  compareExtractionVersion as compareProjectRecordVersion,
} from "@/features/forever-extraction-pipeline";
