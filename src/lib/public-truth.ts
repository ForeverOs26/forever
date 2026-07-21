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

/**
 * Legacy advisory scalars on `projects` that carry NO evidence contract.
 *
 * The repository's own canonical record proves these are placeholders, not
 * evidence: the FDB-001 Modeva seed stores `forever_verified = true` while
 * simultaneously recording `trust_note = 'Awaiting full Forever inspection
 * data.'`, and `partner-demo-data.ts` explicitly refuses to turn that
 * "historical boolean placeholder" into a partner-facing verification. No
 * code path binds any of these columns to a source, an inspection record, a
 * provenance entry, or an Owner-recorded verification action.
 *
 * Until such an evidence contract exists, the public mappers suppress every
 * one of these fields to its absence sentinel. The raw column values remain
 * in the database and internal tooling; only the public claim is withheld.
 */
export const EVIDENCE_UNPROVEN_ADVISORY_COLUMNS = [
  "forever_verified",
  "verified_price",
  "trust_score",
  "trust_note",
  "investment_value",
  "verdict",
  "market_position",
  "rental_demand",
  "rental_yield",
  "capital_growth_estimate",
  "last_inspection",
  "promotion",
] as const;
