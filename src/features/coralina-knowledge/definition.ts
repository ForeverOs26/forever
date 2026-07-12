/**
 * The Coralina project knowledge definition (RC5.1) — RC5.0's vertical slice
 * re-stated as a declarative {@link ProjectKnowledgeDefinition} for the
 * generic engine.
 *
 * Everything here is the SAME data the RC5.0 slice hardcoded: the registered
 * sources, the verbatim facts, the declared gaps, the graph declarations,
 * the readiness profile, and the provenance strings. Only the packaging
 * changed — the unchanged RC5.0 tests and the RC5.1 golden-pin suite hold
 * every judgement and artifact in place (the sole deliberate difference is
 * the engine's project-agnostic RC4.4 chain-summary wording).
 */

import type { ExtractionFact } from "@/features/forever-extraction-pipeline";
import type {
  KnowledgeEntityDeclaration,
  KnowledgeRelationDeclaration,
} from "@/features/forever-knowledge-graph";
import type {
  ProjectKnowledgeDefinition,
  ProjectKnowledgePlanTarget,
} from "@/features/forever-project-knowledge";
import { CORALINA_PROJECT_NAME } from "@/features/coralina-integration";

import { CORALINA_KNOWLEDGE_DESCRIBED_AT, CORALINA_PROJECT_ID, CORALINA_SLUG } from "./identity";
import {
  CORALINA_AREA_FACT,
  CORALINA_EXPECTED_MISSING_PATHS,
  CORALINA_EXTRACTION_FACTS,
  CORALINA_GREEN_SPACE_FACT,
  CORALINA_INDOOR_FACILITIES_FACT,
  CORALINA_OUTDOOR_FACILITIES_FACT,
  CORALINA_PET_FRIENDLY_FACT,
  CORALINA_POOLS_FACT,
} from "./facts";
import {
  CORALINA_BROCHURE_SOURCE,
  CORALINA_FACILITIES_SOURCE,
  CORALINA_KNOWLEDGE_SOURCES,
  CORALINA_LOCATION_MAP_SOURCE,
  CORALINA_MASTER_PLAN_SOURCE,
  CORALINA_PRICE_LIST_SOURCE,
  CORALINA_UNIT_PLANS_SOURCE,
} from "./sources";
import { CORALINA_READINESS_PROFILE } from "./profile";

/** Extraction plan targets per source — only fact types this definition actually states. */
export const CORALINA_PLAN_TARGETS: readonly ProjectKnowledgePlanTarget[] = [
  { source: CORALINA_BROCHURE_SOURCE, factTypes: ["project_name", "location", "amenity"] },
  { source: CORALINA_PRICE_LIST_SOURCE, factTypes: ["unit_type", "document_date"] },
  { source: CORALINA_FACILITIES_SOURCE, factTypes: ["property_type", "inventory", "amenity"] },
  { source: CORALINA_LOCATION_MAP_SOURCE, factTypes: ["location"] },
  { source: CORALINA_UNIT_PLANS_SOURCE, factTypes: ["inventory", "unit_type"] },
  { source: CORALINA_MASTER_PLAN_SOURCE, factTypes: ["document_date"] },
];

/**
 * Knowledge-graph entity declarations, each grounded in a stated fact.
 * No developer entity is declared — Coralina's developer is unknown — and no
 * unit_type entities are declared while the unit-type vocabulary is disputed.
 */
function coralinaEntityDeclarations(): KnowledgeEntityDeclaration[] {
  const amenity = (slug: string, fact: ExtractionFact): KnowledgeEntityDeclaration => ({
    kind: "amenity",
    slug,
    name: fact.rawValue,
    refs: [{ factId: fact.id, sourceId: fact.sourceId }],
  });
  return [
    {
      kind: "location",
      slug: "kamala",
      name: "Kamala",
      refs: [{ factId: CORALINA_AREA_FACT.id, sourceId: CORALINA_AREA_FACT.sourceId }],
    },
    amenity("outdoor-facilities", CORALINA_OUTDOOR_FACILITIES_FACT),
    amenity("indoor-facilities", CORALINA_INDOOR_FACILITIES_FACT),
    amenity("green-space", CORALINA_GREEN_SPACE_FACT),
    amenity("pools", CORALINA_POOLS_FACT),
    amenity("pet-friendly", CORALINA_PET_FRIENDLY_FACT),
  ];
}

function coralinaRelationDeclarations(): KnowledgeRelationDeclaration[] {
  const offers = (slug: string, fact: ExtractionFact): KnowledgeRelationDeclaration => ({
    kind: "offers",
    from: { kind: "project", key: CORALINA_SLUG },
    to: { kind: "amenity", key: slug },
    refs: [{ factId: fact.id, sourceId: fact.sourceId }],
  });
  return [
    {
      kind: "located_in",
      from: { kind: "project", key: CORALINA_SLUG },
      to: { kind: "location", key: "kamala" },
      refs: [{ factId: CORALINA_AREA_FACT.id, sourceId: CORALINA_AREA_FACT.sourceId }],
    },
    offers("outdoor-facilities", CORALINA_OUTDOOR_FACILITIES_FACT),
    offers("indoor-facilities", CORALINA_INDOOR_FACILITIES_FACT),
    offers("green-space", CORALINA_GREEN_SPACE_FACT),
    offers("pools", CORALINA_POOLS_FACT),
    offers("pet-friendly", CORALINA_PET_FRIENDLY_FACT),
  ];
}

/** The complete Coralina definition — RC5.0's data, stated for the RC5.1 engine. */
export const CORALINA_KNOWLEDGE_DEFINITION: ProjectKnowledgeDefinition = {
  identity: {
    projectSlug: CORALINA_SLUG,
    projectId: CORALINA_PROJECT_ID,
    projectName: CORALINA_PROJECT_NAME.value,
    describedAt: CORALINA_KNOWLEDGE_DESCRIBED_AT,
  },
  sources: CORALINA_KNOWLEDGE_SOURCES,
  planTargets: CORALINA_PLAN_TARGETS,
  facts: CORALINA_EXTRACTION_FACTS,
  gaps: CORALINA_EXPECTED_MISSING_PATHS,
  entities: coralinaEntityDeclarations(),
  relations: coralinaRelationDeclarations(),
  readinessProfile: CORALINA_READINESS_PROFILE,
  provenance: {
    mergeAuthor: "coralina-knowledge (RC5.0)",
    mergeReason: "Settle the Coralina extraction facts that passed RC4.7 cross-source validation.",
    createdNote: "Coralina canonical record described from RC4.7-admitted extraction facts.",
  },
  copy: {
    kicker: "Internal inspection — RC5.0 vertical slice",
    intro:
      "Real Coralina source data run end-to-end through the Forever foundations: Project Sources (RC4.4) → Extraction Facts (RC4.5) → Cross-Source Validation (RC4.7) → Canonical Record (RC4.6) → Knowledge Graph (RC4.8) → Readiness (RC4.9). Every value below traces back to a committed source artifact; missing and disputed information is shown, not filled in.",
    sourcesNote:
      "The committed Coralina source artifacts this slice extracts from. No developer, country, legal, or construction source exists in the package — none is registered.",
    missingNote:
      "Fields Coralina's committed sources genuinely do not state. Each is declared to RC4.7 and reported as an explicit missing_information finding — never given a placeholder value.",
    readinessNote:
      "The blockers below are the same two blockers the committed manifest records as SOURCE_PENDING.",
    footer:
      'This page is a deterministic inspection of committed repository data (forever-data/projects/coralina). It performs no network calls, reads no database, and fabricates no values: facts absent from the sources appear under "Missing information", and conflicting statements appear under "Disputed information" unresolved.',
  },
};
