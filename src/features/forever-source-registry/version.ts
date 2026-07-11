/**
 * Forever Source Registry — source version.
 *
 * A {@link SourceVersion} is a plain semantic version for a source definition,
 * so the shape of a source (its capabilities, supported entities, trust) can
 * evolve without silently changing meaning. RC3.3 compares versions purely — it
 * never reads a clock to stamp one, so `0.1.0` always compares to `0.2.0` the
 * same way regardless of when the comparison runs.
 */

/** A semantic version for a source definition. */
export interface SourceVersion {
  major: number;
  minor: number;
  patch: number;
  /** Optional pre-release/build label, e.g. `draft`. Never used in ordering. */
  label?: string;
}

/** Build a {@link SourceVersion}; omitted parts default to `0`. */
export function sourceVersion(major = 0, minor = 0, patch = 0, label?: string): SourceVersion {
  return label === undefined ? { major, minor, patch } : { major, minor, patch, label };
}

/** Render a version as `major.minor.patch` with an optional `-label` suffix. */
export function formatSourceVersion(version: SourceVersion): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.label === undefined ? base : `${base}-${version.label}`;
}

/**
 * Compare two versions by `major`, then `minor`, then `patch`.
 *
 * Returns a negative number when `a` precedes `b`, `0` when the numeric parts
 * are equal, and positive otherwise. The `label` never participates in ordering,
 * so the comparison is total and deterministic.
 */
export function compareSourceVersion(a: SourceVersion, b: SourceVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}
