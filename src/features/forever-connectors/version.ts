/**
 * Forever Connectors — connector version.
 *
 * A {@link ConnectorVersion} is a plain semantic version for a connector
 * definition, so the shape of a connector (its capabilities, configuration,
 * supported entities) can evolve without silently changing meaning. RC3.4
 * compares versions purely — it never reads a clock to stamp one, so `0.1.0`
 * always compares to `0.2.0` the same way regardless of when the comparison
 * runs.
 *
 * It mirrors the Forever Source Registry (RC3.3) version shape so the two
 * foundations version their descriptors identically, while staying a distinct
 * type for a distinct concept.
 */

/** A semantic version for a connector definition. */
export interface ConnectorVersion {
  major: number;
  minor: number;
  patch: number;
  /** Optional pre-release/build label, e.g. `draft`. Never used in ordering. */
  label?: string;
}

/** Build a {@link ConnectorVersion}; omitted parts default to `0`. */
export function connectorVersion(
  major = 0,
  minor = 0,
  patch = 0,
  label?: string,
): ConnectorVersion {
  return label === undefined ? { major, minor, patch } : { major, minor, patch, label };
}

/** Render a version as `major.minor.patch` with an optional `-label` suffix. */
export function formatConnectorVersion(version: ConnectorVersion): string {
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
export function compareConnectorVersion(a: ConnectorVersion, b: ConnectorVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}
