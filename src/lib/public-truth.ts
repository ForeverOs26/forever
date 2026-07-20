/**
 * FOREVER-TRUTH-001A — public truth policy.
 *
 * The public product is fail-closed:
 *
 *   missing evidence → false / null / "Not available" / hidden claim
 *
 * Never:
 *
 *   missing evidence → verified badge / positive score / Strong Buy /
 *                      assumed image / invented review / invented offer
 *
 * This module also quarantines the six fictitious demo projects seeded by
 * migration `20260704060123` (and re-published by the `20260718113000`
 * backfill). Repository history contains no cleanup for those rows, so until
 * the separately Owner-approved production deactivation runs, every public
 * data boundary must refuse to serve them. See
 * `docs/FOREVER_TRUTH_001A_PRODUCTION_CLEANUP_PLAN.md`.
 */

/**
 * Slugs of the seeded fictitious demo projects. These are quarantine keys,
 * not content: they exist so the known-fictitious rows can be recognized and
 * excluded wherever project data reaches a public surface (catalogue, detail,
 * sitemap, Navigator, Advisory candidate lists).
 */
export const KNOWN_FICTITIOUS_PROJECT_SLUGS = [
  "surin-ridge-villas",
  "kamala-beach-residences",
  "layan-forest-villas",
  "bangtao-garden-pool-villas",
  "kata-cliff-residences",
  "rawai-courtyard-villas",
] as const;

const KNOWN_FICTITIOUS_SLUG_SET: ReadonlySet<string> = new Set(KNOWN_FICTITIOUS_PROJECT_SLUGS);

export function isKnownFictitiousProjectSlug(slug: string): boolean {
  return KNOWN_FICTITIOUS_SLUG_SET.has(slug);
}

/** Removes known-fictitious entries from any slug-bearing collection. */
export function excludeKnownFictitiousProjects<T extends { slug: string }>(rows: T[]): T[] {
  return rows.filter((row) => !isKnownFictitiousProjectSlug(row.slug));
}
