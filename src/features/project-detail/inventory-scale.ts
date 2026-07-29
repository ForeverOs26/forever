/**
 * How many residences Forever lists, stated as such
 * (FOREVER-PR116-RELEASE-STABILIZATION-001, finding F1).
 *
 * The project detail page used to head its inventory "15 residences" and
 * "3 buildings · 304 residences". Both read as the size of the development.
 * They are not: they are the number of rows in the price list Forever currently
 * holds. The data-readiness audit found Cielo listing 15 of 171 units and
 * Legendary 63 of 637 — so the old heading understated two developments by an
 * order of magnitude while sounding authoritative about them.
 *
 * The fix is to say which number is being shown. "15 listed residences" is
 * true whatever the development's real size turns out to be.
 *
 * The second half of the fix is structural, and it is the reason this module
 * exists rather than a string literal at the call site: a *total* project unit
 * count is a different fact with a different source, and nothing here may
 * silently stand in for it. See `verifiedTotalProjectUnits`.
 */

import type { ProjectDetail } from "./project-detail-types";
import { buildingCodes } from "./unit-presentation";

/** The label for the listed-inventory figure, wherever it is shown as a fact. */
export const LISTED_IN_FOREVER_LABEL = "Listed in Forever";

/** The label for a verified development-wide unit count, when one exists. */
export const TOTAL_PROJECT_UNITS_LABEL = "Total project units";

/**
 * The number of residences Forever currently lists for this project.
 *
 * This is a count of rows the public projection returned. It is never a claim
 * about the development.
 */
export function listedResidenceCount(project: ProjectDetail): number {
  return project.units.length;
}

/**
 * The total number of units in the development, when Forever holds a verified
 * figure for it — otherwise `null`.
 *
 * Today this is always `null`, and deliberately so. No development-wide unit
 * total reaches this page:
 *
 *   - `projects` has no `total_units` column at all.
 *   - `buildings.units_count` does exist and *is* granted to the anonymous role
 *     (`20260726140000_public_unit_price_projection.sql`), but the detail query
 *     requests only `building:buildings(building_code)`
 *     (`project-detail-service.ts`), so the figure is not in the payload. It is
 *     also recorded for only two of the nine projects.
 *   - The totals quoted in the research documents — Legendary 637, Serenity
 *     814, Adora 210 — are readings of official brochures. They are editorial
 *     findings, not published data, and must never be hardcoded into the
 *     frontend.
 *
 * So the honest answer today is "not available", for every project.
 *
 * The parameter is intentionally unread. That is the guarantee: there is no
 * expression in this function that could reach `project.units`, so no future
 * edit can turn the listed-row count into a project total by accident. When a
 * verified total does become available it arrives as its own field, and only
 * that field may be returned here.
 */
export function verifiedTotalProjectUnits(_project: ProjectDetail): number | null {
  return null;
}

/** `n listed residences`, singular when there is one. */
export function listedResidencesPhrase(count: number): string {
  return `${count} listed ${count === 1 ? "residence" : "residences"}`;
}

/**
 * The inventory heading.
 *
 * Buildings are counted from the building codes the listed units carry, so the
 * figure is subject to exactly the same caveat as the residence count and is
 * stated alongside it rather than as a separate authority on the development.
 */
export function listedInventoryHeading(project: ProjectDetail): string {
  const residences = listedResidencesPhrase(listedResidenceCount(project));
  const buildings = buildingCodes(project.units).length;
  if (buildings === 0) return residences;
  return `${buildings} ${buildings === 1 ? "building" : "buildings"} · ${residences}`;
}
