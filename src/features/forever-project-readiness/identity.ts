/**
 * Forever Project Readiness — report, evaluation, and profile identity.
 *
 * The deterministic naming helpers reuse the RC4.6 slug rule (itself the
 * RC4.5/RC4.4/RC4.2/RC3.0 `slugify` rule) and the RC4.2 `proj_` project-id
 * convention rather than restating any identity logic. They take no clock,
 * counter, or randomness, and therefore always produce byte-identical ids —
 * which is what makes a readiness report safe to regenerate, diff, and
 * validate.
 *
 * A report is addressed by the project it examines, with an optional
 * caller-stated batch slug participating so repeated examinations of the
 * same project never collide — the batch is a caller's statement, never an
 * invented discriminator (the RC4.7 report-id convention, reused). An
 * evaluation is addressed *within* its report by its requirement kind and
 * its 1-based position among evaluations of that kind in the report's one
 * deterministic order — the RC4.7 finding-id convention, reused. A profile
 * is addressed by its own slug, so the same stated profile always derives
 * the same id.
 */

import {
  normalizeProjectDatabaseSlug,
  projectDatabaseProjectId,
} from "@/features/forever-project-database";

// Reuse the RC4.6 slug rule (itself RC4.5/RC4.4/RC4.2/RC3.0 `slugify`) under a
// readiness-facing name — one normalization rule across the whole system,
// never a local variant.
export { normalizeProjectDatabaseSlug as normalizeReadinessSlug };

// Reuse the RC4.2 `proj_` convention (through the RC4.6 re-export — the very
// same function) so a report's project id is byte-identical to the id every
// other foundation derives for the same slug.
export { projectDatabaseProjectId as readinessProjectId };

/** The id prefix conventions RC4.9 derives its ids from. */
export const READINESS_ID_PREFIXES = {
  report: "rrep_",
  evaluation: "reva_",
  profile: "rprf_",
} as const;

/**
 * Deterministic report id for a project slug and optional caller-stated
 * batch slug, e.g. (`coralina`) → `rrep_coralina` and (`coralina`,
 * `2026-07`) → `rrep_coralina-2026-07`.
 *
 * The batch participates in the id only when the caller states one, so two
 * examinations the caller distinguishes never collide — and an unstated
 * batch is never fabricated into the name.
 */
export function readinessReportIdFor(projectSlug: string, batch?: string): string {
  const base = `${READINESS_ID_PREFIXES.report}${normalizeProjectDatabaseSlug(projectSlug)}`;
  return batch === undefined ? base : `${base}-${normalizeProjectDatabaseSlug(batch)}`;
}

/**
 * Deterministic evaluation id for a project slug, requirement kind, and the
 * evaluation's 1-based position among evaluations of the same kind in the
 * report's deterministic order, e.g. (`coralina`, `field_present`, 1) →
 * `reva_coralina-field-present-1`.
 *
 * The ordinal participates so two evaluations of one kind never collide, and
 * because the report's evaluation order is itself deterministic, the same
 * input always derives the same evaluation ids — the RC4.7 finding-id
 * convention, reused.
 */
export function readinessEvaluationIdFor(
  projectSlug: string,
  kind: string,
  ordinal: number,
): string {
  return `${READINESS_ID_PREFIXES.evaluation}${normalizeProjectDatabaseSlug(
    projectSlug,
  )}-${normalizeProjectDatabaseSlug(kind)}-${ordinal}`;
}

/**
 * Deterministic profile id for a profile slug, e.g. (`minimum-intake`) →
 * `rprf_minimum-intake`.
 *
 * A profile is a reusable statement of requirements, addressed by its own
 * slug rather than a project — the same stated profile gates any number of
 * projects under one id.
 */
export function readinessProfileIdFor(profileSlug: string): string {
  return `${READINESS_ID_PREFIXES.profile}${normalizeProjectDatabaseSlug(profileSlug)}`;
}
