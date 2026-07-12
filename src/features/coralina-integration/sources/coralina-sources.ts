/**
 * Coralina source definitions (RC3.3).
 *
 * Declares one {@link SourceDefinition} per verified Coralina source artifact.
 * A source is registered only when the committed material actually contains it —
 * the six sources below correspond to the brochure, price list, master plan,
 * unit plans, media, and classified documents that exist under
 * `forever-data/projects/coralina/`. No source is invented, and no source is
 * registered for material Coralina does not have (there is, for example, no
 * developer-information or construction-information source).
 *
 * The pure-image collections (unit plans, media) are typed `unknown`: the RC3.3
 * {@link SourceType} vocabulary has no image/video kind, and the anti-fabrication
 * rule requires representing an unclassifiable source explicitly rather than
 * mislabelling it as a format it is not.
 */

import {
  defineSource,
  sourceCapability,
  sourceCategoryForType,
  sourceVersion,
  type SourceDefinition,
  type SourceEntityKind,
  type SourceType,
} from "@/features/forever-source-registry";

import {
  CORALINA_BROCHURE_SOURCE_ID,
  CORALINA_DOCUMENTS_SOURCE_ID,
  CORALINA_MASTERPLAN_SOURCE_ID,
  CORALINA_MEDIA_SOURCE_ID,
  CORALINA_PRICE_LIST_SOURCE_ID,
  CORALINA_UNIT_PLANS_SOURCE_ID,
} from "../identity";

interface CoralinaSourceSpec {
  id: string;
  slug: string;
  name: string;
  type: SourceType;
  trustLevel: SourceDefinition["trustLevel"];
  supportedEntities: SourceEntityKind[];
  carries: "documents" | "media";
  description: string;
}

const SPECS: readonly CoralinaSourceSpec[] = [
  {
    id: CORALINA_BROCHURE_SOURCE_ID,
    slug: "coralina-brochure",
    name: "Coralina Brochure",
    type: "pdf",
    trustLevel: "high",
    supportedEntities: ["project", "document"],
    carries: "documents",
    description: "Developer e-brochure — verified project identity, location, and facilities.",
  },
  {
    id: CORALINA_PRICE_LIST_SOURCE_ID,
    slug: "coralina-price-list",
    name: "Coralina Price List",
    type: "pdf",
    trustLevel: "high",
    supportedEntities: ["project", "document"],
    carries: "documents",
    description: "Developer price list — verified unit inventory (feeds the project's units).",
  },
  {
    id: CORALINA_MASTERPLAN_SOURCE_ID,
    slug: "coralina-masterplan",
    name: "Coralina Master Plan",
    type: "pdf",
    trustLevel: "standard",
    supportedEntities: ["media", "document"],
    carries: "media",
    description: "Master plan document and its rendered images.",
  },
  {
    id: CORALINA_UNIT_PLANS_SOURCE_ID,
    slug: "coralina-unit-plans",
    name: "Coralina Unit Plans",
    type: "unknown",
    trustLevel: "standard",
    supportedEntities: ["media"],
    carries: "media",
    description: "Floor-plan images (image files; no image SourceType exists in RC3.3).",
  },
  {
    id: CORALINA_MEDIA_SOURCE_ID,
    slug: "coralina-media",
    name: "Coralina Media",
    type: "unknown",
    trustLevel: "standard",
    supportedEntities: ["media"],
    carries: "media",
    description: "Perspective/gallery images and videos (image/video files; no image SourceType).",
  },
  {
    id: CORALINA_DOCUMENTS_SOURCE_ID,
    slug: "coralina-documents",
    name: "Coralina Documents",
    type: "pdf",
    trustLevel: "standard",
    supportedEntities: ["document"],
    carries: "documents",
    description: "Classified source documents (brochures, price lists, company profile, maps).",
  },
];

function buildSource(spec: CoralinaSourceSpec): SourceDefinition {
  return defineSource({
    identity: {
      id: spec.id,
      slug: spec.slug,
      name: spec.name,
      type: spec.type,
      category: sourceCategoryForType(spec.type),
    },
    version: sourceVersion(0, 1, 0),
    lifecycle: "active",
    priority: "primary",
    trustLevel: spec.trustLevel,
    capabilities: [sourceCapability("read"), sourceCapability(spec.carries)],
    supportedEntities: spec.supportedEntities,
    // These are a manually-provided developer file package pulled into Forever.
    syncSystem: "manual",
    syncDirections: ["pull"],
    metadata: {
      description: spec.description,
      owner: "Forever intake",
      region: "Phuket",
      tags: ["coralina", "developer-package"],
    },
  });
}

/** Every verified Coralina source definition, in declared order. */
export const CORALINA_SOURCE_DEFINITIONS: readonly SourceDefinition[] = SPECS.map(buildSource);

/** The Coralina source definitions keyed by id, for direct reference resolution. */
export const CORALINA_SOURCE_DEFINITIONS_BY_ID: ReadonlyMap<string, SourceDefinition> = new Map(
  CORALINA_SOURCE_DEFINITIONS.map((definition) => [definition.identity.id, definition]),
);
