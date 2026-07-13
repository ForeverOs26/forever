/**
 * Coralina canonical identity — stable, deterministic ids and slugs.
 *
 * Every identifier the Coralina vertical slice uses is derived here from a
 * verified natural key (the project slug, a developer unit number, a source
 * file path), never from randomness, a clock, or a counter. Regenerating the
 * whole integration therefore always produces byte-identical ids, which is what
 * makes the bundle safe to validate, diff, and re-derive.
 *
 * The slugs conform to the Forever Database slug rule (lowercase, hyphenated),
 * so a Coralina record is addressed exactly the way every other canonical
 * Forever entity is.
 */

import { slugify, type ForeverId, type Slug } from "@/features/forever-database";

import { CORALINA_PROJECT_SLUG } from "./data/coralina-facts";

/** The project slug — the natural key every other Coralina id hangs off. */
export const CORALINA_SLUG: Slug = CORALINA_PROJECT_SLUG;

/** Canonical project id. */
export const CORALINA_PROJECT_ID: ForeverId = `proj_${CORALINA_SLUG}`;

/** Canonical developer id derived from the verified legal name. */
export const CORALINA_DEVELOPER_ID: ForeverId = "dev_rhom-bho-property-public-company-limited";

/** Canonical location id (project-scoped, one location per project). */
export const CORALINA_LOCATION_ID: ForeverId = `${CORALINA_PROJECT_ID}::location`;

/** Source Registry ids for the verified Coralina sources. */
export const CORALINA_BROCHURE_SOURCE_ID = "src_coralina_brochure";
export const CORALINA_PRICE_LIST_SOURCE_ID = "src_coralina_price_list";
export const CORALINA_MASTERPLAN_SOURCE_ID = "src_coralina_masterplan";
export const CORALINA_UNIT_PLANS_SOURCE_ID = "src_coralina_unit_plans";
export const CORALINA_MEDIA_SOURCE_ID = "src_coralina_media";
export const CORALINA_DOCUMENTS_SOURCE_ID = "src_coralina_documents";

/** Connector id for the Coralina developer-package file connector. */
export const CORALINA_CONNECTOR_ID = "conn_coralina_developer_package";

/** Pipeline id for the Coralina import pipeline. */
export const CORALINA_PIPELINE_ID = "pipe_coralina_import";

/** Project Integration id and registry ids for the Coralina bundle. */
export const CORALINA_INTEGRATION_ID = "integ_coralina";
export const CORALINA_SOURCE_REGISTRY_ID = "coralina-sources";
export const CORALINA_CONNECTOR_REGISTRY_ID = "coralina-connectors";
export const CORALINA_PIPELINE_REGISTRY_ID = "coralina-pipelines";
export const CORALINA_INTEGRATION_REGISTRY_ID = "coralina-integrations";

/**
 * Deterministic canonical id for a unit, from its verified unit number.
 *
 * The unit number (e.g. `CKA201`) is the developer's own natural key, so the id
 * is stable across regenerations and unique across the 198 units.
 */
export function coralinaUnitId(unitNumber: string): ForeverId {
  return `${CORALINA_PROJECT_ID}::unit::${unitNumber}`;
}

/**
 * Deterministic canonical id for a document or media asset, from its verified
 * repo-relative source-file path.
 *
 * The source path is unique per asset, so slugifying it yields a stable,
 * collision-free id without inventing a surrogate key.
 */
export function coralinaAssetId(prefix: "media" | "document", sourceFile: string): ForeverId {
  return `${CORALINA_PROJECT_ID}::${prefix}::${slugify(sourceFile)}`;
}
