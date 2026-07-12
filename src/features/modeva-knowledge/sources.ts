/**
 * Modeva project sources, registered through the RC4.4 Project Sources model.
 *
 * Modeva has NO committed developer package: `forever-data/projects/modeva/`
 * was never committed to this repository (only the Coralina package is).
 * What IS committed — and what these definitions therefore register — are
 * the repository's own canonical artifacts that state Modeva facts:
 *
 * - the canonical seed migration (FDB-001), which states the project's
 *   identity, developer, location, tenure, and construction status. The seed
 *   itself records "Awaiting full Forever inspection data", so it is
 *   registered at `standard` trust rather than the `forever_verified`
 *   default of high;
 * - the reviewed price-list import migration (FDB-002C), which embeds the
 *   289 reviewed unit rows with per-row provenance (source file, page, row)
 *   pointing at the developer price list "MOB - Price list V.2. - Updated
 *   03.07.2026.pdf". That underlying PDF is not committed — the migration is
 *   the committed statement of its content. It is registered at version
 *   2.0.0 because the embedded artifact is titled "Price list V.2"
 *   (mirroring the Coralina precedent), with the price list's own stated
 *   date as the document date;
 * - the real-run verification report (FDB-003C), which records the counts
 *   actually observed against the connected database (7 buildings, 289
 *   units) and the import's own output lines — an observation artifact,
 *   registered at `standard` trust.
 *
 * No source is invented: there is deliberately NO brochure, master-plan,
 * unit-plan, amenity, rental, or legal source, because no such Modeva
 * artifact is committed to this repository.
 */

import {
  describeProjectSource,
  projectSourceAuthority,
  projectSourceVersion,
  type ProjectSourceDefinition,
} from "@/features/forever-project-sources";

import { MODEVA_DATASETS, MODEVA_SLUG } from "./identity";

const PACKAGE_METADATA = {
  owner: "Forever intake",
  region: "Phuket",
  tags: ["modeva", "canonical-artifacts", "rc5.1"],
};

/** Canonical seed migration (FDB-001) — identity, developer, location, tenure, status. */
export const MODEVA_CANONICAL_SEED_SOURCE: ProjectSourceDefinition = describeProjectSource({
  projectSlug: MODEVA_SLUG,
  sourceSlug: "canonical-seed",
  name: "Modeva Canonical Seed (FDB-001)",
  documentType: "specification",
  fileFormat: "text",
  version: projectSourceVersion(1, 0, 0),
  authority: projectSourceAuthority("forever_verified", { trust: "standard" }),
  status: "verified",
  origin: "manual_entry",
  metadata: {
    ...PACKAGE_METADATA,
    description: MODEVA_DATASETS.canonicalSeed,
  },
});

/** Reviewed price-list import migration (FDB-002C) — 289 unit rows with per-row provenance. */
export const MODEVA_PRICE_LIST_IMPORT_SOURCE: ProjectSourceDefinition = describeProjectSource({
  projectSlug: MODEVA_SLUG,
  sourceSlug: "price-list-import",
  name: "Modeva Price List V.2 Import (FDB-002C)",
  documentType: "price_list",
  fileFormat: "text",
  version: projectSourceVersion(2, 0, 0),
  authority: projectSourceAuthority("forever_verified"),
  status: "verified",
  origin: "manual_entry",
  documentDate: "2026-07-03",
  metadata: {
    ...PACKAGE_METADATA,
    description: MODEVA_DATASETS.priceListImport,
  },
});

/** Real-run verification report (FDB-003C) — counts observed against the connected database. */
export const MODEVA_REAL_RUN_REPORT_SOURCE: ProjectSourceDefinition = describeProjectSource({
  projectSlug: MODEVA_SLUG,
  sourceSlug: "real-run-report",
  name: "Modeva Import Real-Run Report (FDB-003C)",
  documentType: "specification",
  fileFormat: "text",
  version: projectSourceVersion(1, 0, 0),
  authority: projectSourceAuthority("forever_verified", { trust: "standard" }),
  status: "verified",
  origin: "manual_entry",
  metadata: {
    ...PACKAGE_METADATA,
    description: MODEVA_DATASETS.realRunReport,
  },
});

/** Every Modeva source this definition registers, in declared order. */
export const MODEVA_KNOWLEDGE_SOURCES: readonly ProjectSourceDefinition[] = [
  MODEVA_CANONICAL_SEED_SOURCE,
  MODEVA_PRICE_LIST_IMPORT_SOURCE,
  MODEVA_REAL_RUN_REPORT_SOURCE,
];
