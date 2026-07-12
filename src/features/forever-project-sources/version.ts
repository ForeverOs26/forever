/**
 * Forever Project Sources — source version.
 *
 * A {@link ProjectSourceVersion} records which revision of a document a
 * catalogued source describes, so the registry can hold multiple versions of
 * the same document without implementing storage. The shape *is* the RC3.3
 * {@link import("@/features/forever-source-registry").SourceVersion}, reused
 * wholesale rather than restated — one semantic-version shape, one formatter,
 * and one comparison rule across the whole source family, and nothing to drift
 * out of sync. RC4.4 compares versions purely; it never reads a clock to stamp
 * one.
 */

import { compareSourceVersion, type SourceVersion } from "@/features/forever-source-registry";

/** The revision of a document a catalogued source describes. Reuses RC3.3. */
export type ProjectSourceVersion = SourceVersion;

// Reuse the RC3.3 constructor, formatter, and comparator under project-source
// names — one version implementation across the whole source family.
export {
  sourceVersion as projectSourceVersion,
  formatSourceVersion as formatProjectSourceVersion,
  compareSourceVersion as compareProjectSourceVersion,
} from "@/features/forever-source-registry";

/**
 * The highest version in a list, or `undefined` for an empty list.
 *
 * Pure and stable: ties (identical numeric parts) resolve to the earliest
 * occurrence, and the input list is never mutated.
 */
export function latestProjectSourceVersion(
  versions: readonly ProjectSourceVersion[],
): ProjectSourceVersion | undefined {
  let latest: ProjectSourceVersion | undefined;
  for (const version of versions) {
    if (latest === undefined || compareSourceVersion(version, latest) > 0) {
      latest = version;
    }
  }
  return latest;
}
