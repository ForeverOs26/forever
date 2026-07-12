/**
 * Coralina project sources, registered through the RC4.4 Project Sources model.
 *
 * One `ProjectSourceDefinition` per Coralina source artifact that this slice
 * extracts facts from. Every descriptor value is source-backed:
 *
 * - the artifact paths and filenames are attested by the committed extraction
 *   datasets and classification log under `forever-data/projects/coralina/`
 *   (the binary files themselves are not committed to the repository — the
 *   `source/` folders hold placeholders),
 * - document dates come from the artifacts' own stated dates
 *   (price list "Updated 03.07.26" → 2026-07-03; e-brochure file dated
 *   20251209 → 2025-12-09; the master-plan collection's dated render,
 *   20251009 → 2025-10-09),
 * - the price list is registered at version 2.0.0 because the artifact itself
 *   is titled "Price List V.2",
 * - trust mirrors the repository's existing RC3.3 Coralina judgement: the
 *   brochure and price list are high-trust developer materials, the
 *   supporting documents and image collections are standard-trust.
 *
 * No source is invented: there is deliberately NO developer-information,
 * country, legal, construction-status, or rental/investment source, because
 * Coralina's committed package contains none.
 */

import {
  describeProjectSource,
  projectSourceAuthority,
  projectSourceVersion,
  ProjectSourceRegistry,
  type ProjectSourceDefinition,
} from "@/features/forever-project-sources";

import { CORALINA_SLUG } from "./identity";

const PACKAGE_METADATA = {
  owner: "Forever intake",
  region: "Phuket",
  tags: ["coralina", "developer-package", "rc5.0"],
};

/** Developer e-brochure — project identity, location, and amenity statements. */
export const CORALINA_BROCHURE_SOURCE: ProjectSourceDefinition = describeProjectSource({
  projectSlug: CORALINA_SLUG,
  sourceSlug: "brochure",
  name: "Coralina E-Brochure",
  documentType: "brochure",
  fileFormat: "pdf",
  version: projectSourceVersion(1, 0, 0),
  authority: projectSourceAuthority("developer_official"),
  status: "verified",
  origin: "manual_entry",
  documentDate: "2025-12-09",
  metadata: {
    ...PACKAGE_METADATA,
    description:
      "forever-data/projects/coralina/source/brochure/2. E-Brochure__20251209 Coralina E-brochure.pdf",
  },
});

/** Developer price list V.2 (updated 03.07.26) — unit inventory and list date. */
export const CORALINA_PRICE_LIST_SOURCE: ProjectSourceDefinition = describeProjectSource({
  projectSlug: CORALINA_SLUG,
  sourceSlug: "price-list",
  name: "Coralina Price List V.2",
  documentType: "price_list",
  fileFormat: "pdf",
  version: projectSourceVersion(2, 0, 0),
  authority: projectSourceAuthority("developer_official"),
  status: "verified",
  origin: "manual_entry",
  documentDate: "2026-07-03",
  metadata: {
    ...PACKAGE_METADATA,
    description:
      "forever-data/projects/coralina/source/price-list/CLK - Price List V.2. - Updated 03.07.26.pdf",
  },
});

/** Facilities document — project type, buildings, and facility statements. */
export const CORALINA_FACILITIES_SOURCE: ProjectSourceDefinition = describeProjectSource({
  projectSlug: CORALINA_SLUG,
  sourceSlug: "facilities",
  name: "Coralina Facilities",
  documentType: "specification",
  fileFormat: "pdf",
  version: projectSourceVersion(1, 0, 0),
  authority: projectSourceAuthority("developer_official", { trust: "standard" }),
  status: "verified",
  origin: "manual_entry",
  metadata: {
    ...PACKAGE_METADATA,
    description:
      "forever-data/projects/coralina/source/documents/3. Facilities__Coralina Facilities.pdf",
  },
});

/** Location map image — the beach-proximity area-detail statement. */
export const CORALINA_LOCATION_MAP_SOURCE: ProjectSourceDefinition = describeProjectSource({
  projectSlug: CORALINA_SLUG,
  sourceSlug: "location-map",
  name: "Coralina Location Map 2",
  documentType: "marketing_material",
  fileFormat: "image",
  version: projectSourceVersion(1, 0, 0),
  authority: projectSourceAuthority("developer_official", { trust: "standard" }),
  status: "verified",
  origin: "manual_entry",
  metadata: {
    ...PACKAGE_METADATA,
    description: "forever-data/projects/coralina/source/documents/9. Map__CORALINA Map 2.jpeg",
  },
});

/** Floor-plan image collection — building and unit-type label statements. */
export const CORALINA_UNIT_PLANS_SOURCE: ProjectSourceDefinition = describeProjectSource({
  projectSlug: CORALINA_SLUG,
  sourceSlug: "unit-plans",
  name: "Coralina Unit Plans",
  documentType: "unit_plan",
  fileFormat: "image",
  version: projectSourceVersion(1, 0, 0),
  authority: projectSourceAuthority("developer_official", { trust: "standard" }),
  status: "verified",
  origin: "manual_entry",
  metadata: {
    ...PACKAGE_METADATA,
    description:
      "forever-data/projects/coralina/source/unit-plans/ (198 classified floor-plan and unit-plan files)",
  },
});

/**
 * Master plan — the master-plan document and its rendered images, as one
 * collection (mirroring the RC3.3 Coralina judgement). The document date is
 * stated by the collection's dated render
 * (`4. Master Plan__JPG__20251009_Coralina_Master Plan-01.jpg`).
 */
export const CORALINA_MASTER_PLAN_SOURCE: ProjectSourceDefinition = describeProjectSource({
  projectSlug: CORALINA_SLUG,
  sourceSlug: "master-plan",
  name: "Coralina Master Plan",
  documentType: "master_plan",
  fileFormat: "pdf",
  version: projectSourceVersion(1, 0, 0),
  authority: projectSourceAuthority("developer_official", { trust: "standard" }),
  status: "verified",
  origin: "manual_entry",
  documentDate: "2025-10-09",
  metadata: {
    ...PACKAGE_METADATA,
    description:
      "forever-data/projects/coralina/source/masterplan/ (master-plan document and rendered images, 10 files)",
  },
});

/** Every Coralina source this slice registers, in declared order. */
export const CORALINA_KNOWLEDGE_SOURCES: readonly ProjectSourceDefinition[] = [
  CORALINA_BROCHURE_SOURCE,
  CORALINA_PRICE_LIST_SOURCE,
  CORALINA_FACILITIES_SOURCE,
  CORALINA_LOCATION_MAP_SOURCE,
  CORALINA_UNIT_PLANS_SOURCE,
  CORALINA_MASTER_PLAN_SOURCE,
];

/** Fresh RC4.4 registry with every Coralina source registered. */
export function buildCoralinaKnowledgeSourceRegistry(): ProjectSourceRegistry {
  const registry = new ProjectSourceRegistry();
  for (const source of CORALINA_KNOWLEDGE_SOURCES) {
    registry.register(source);
  }
  return registry;
}
