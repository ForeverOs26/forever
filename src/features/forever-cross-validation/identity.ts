/**
 * Forever Cross-Source Validation — report and finding identity.
 *
 * The deterministic naming helpers reuse the RC4.6 slug rule (itself the
 * RC4.5/RC4.4/RC4.2/RC3.0 `slugify` rule) and the RC4.2 `proj_` project-id
 * convention rather than restating any identity logic. They take no clock,
 * counter, or randomness, and therefore always produce byte-identical ids —
 * which is what makes a cross-validation report safe to regenerate, diff, and
 * validate.
 *
 * A report is addressed by the project it examines, with an optional
 * caller-stated batch slug participating so repeated examinations of the same
 * project never collide — the batch is a caller's statement, never an
 * invented discriminator. A finding is addressed *within* its report by its
 * kind and its 1-based position among findings of that kind in the report's
 * one deterministic order, so the same input always derives the same finding
 * ids.
 */

import {
  normalizeProjectDatabaseSlug,
  projectDatabaseProjectId,
} from "@/features/forever-project-database";

// Reuse the RC4.6 slug rule (itself RC4.5/RC4.4/RC4.2/RC3.0 `slugify`) under a
// cross-validation-facing name — one normalization rule across the whole
// system, never a local variant.
export { normalizeProjectDatabaseSlug as normalizeCrossValidationSlug };

// Reuse the RC4.2 `proj_` convention (through the RC4.6 re-export — the very
// same function) so a report's project id is byte-identical to the id every
// other foundation derives for the same slug.
export { projectDatabaseProjectId as crossValidationProjectId };

/** The id prefix conventions RC4.7 derives its ids from. */
export const CROSS_VALIDATION_ID_PREFIXES = {
  report: "xrep_",
  finding: "xfnd_",
} as const;

/**
 * Deterministic report id for a project slug and optional caller-stated batch
 * slug, e.g. (`coralina`) → `xrep_coralina` and (`coralina`, `2026-07`) →
 * `xrep_coralina-2026-07`.
 *
 * The batch participates in the id only when the caller states one, so two
 * examinations the caller distinguishes never collide — and an unstated batch
 * is never fabricated into the name.
 */
export function crossValidationReportIdFor(projectSlug: string, batch?: string): string {
  const base = `${CROSS_VALIDATION_ID_PREFIXES.report}${normalizeProjectDatabaseSlug(projectSlug)}`;
  return batch === undefined ? base : `${base}-${normalizeProjectDatabaseSlug(batch)}`;
}

/**
 * Deterministic finding id for a project slug, finding kind, and the
 * finding's 1-based position among findings of the same kind in the report's
 * deterministic order, e.g. (`coralina`, `conflict`, 1) →
 * `xfnd_coralina-conflict-1`.
 *
 * The ordinal participates so two findings of one kind never collide, and
 * because the report's finding order is itself deterministic, the same input
 * always derives the same ids.
 */
export function crossValidationFindingIdFor(
  projectSlug: string,
  kind: string,
  ordinal: number,
): string {
  return `${CROSS_VALIDATION_ID_PREFIXES.finding}${normalizeProjectDatabaseSlug(
    projectSlug,
  )}-${normalizeProjectDatabaseSlug(kind)}-${ordinal}`;
}
