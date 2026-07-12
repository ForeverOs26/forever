/**
 * The Modeva project knowledge definition (RC5.1) — the second real project
 * stated for the generic engine, proving that onboarding a project onto the
 * RC4.4–RC4.9 chain is now a declaration, not new orchestration code.
 *
 * Every value is a verbatim transcription of a committed repository
 * artifact; see `facts.ts` for the confidence policy and the
 * anti-fabrication rule. The expected readiness verdict is BLOCKED: Modeva
 * is live in the product database, but its committed knowledge package has
 * no developer brochure, master plan, or unit plans — an honest gap this
 * definition surfaces instead of smoothing over.
 */

import type {
  KnowledgeEntityDeclaration,
  KnowledgeRelationDeclaration,
} from "@/features/forever-knowledge-graph";
import type {
  ProjectKnowledgeDefinition,
  ProjectKnowledgePlanTarget,
} from "@/features/forever-project-knowledge";

import {
  MODEVA_AREA_SEED_FACT,
  MODEVA_DEVELOPER_SEED_FACT,
  MODEVA_EXPECTED_MISSING_PATHS,
  MODEVA_EXTRACTION_FACTS,
} from "./facts";
import { MODEVA_KNOWLEDGE_DESCRIBED_AT, MODEVA_PROJECT_ID, MODEVA_SLUG } from "./identity";
import { MODEVA_READINESS_PROFILE } from "./profile";
import {
  MODEVA_CANONICAL_SEED_SOURCE,
  MODEVA_KNOWLEDGE_SOURCES,
  MODEVA_PRICE_LIST_IMPORT_SOURCE,
  MODEVA_REAL_RUN_REPORT_SOURCE,
} from "./sources";

/** Extraction plan targets per source — only fact types this definition actually states. */
export const MODEVA_PLAN_TARGETS: readonly ProjectKnowledgePlanTarget[] = [
  {
    source: MODEVA_CANONICAL_SEED_SOURCE,
    factTypes: [
      "project_name",
      "property_type",
      "developer",
      "location",
      "ownership_type",
      "construction_status",
    ],
  },
  {
    source: MODEVA_PRICE_LIST_IMPORT_SOURCE,
    factTypes: ["inventory", "unit_type", "currency", "document_date"],
  },
  {
    source: MODEVA_REAL_RUN_REPORT_SOURCE,
    factTypes: ["project_name", "developer", "location", "inventory"],
  },
];

/**
 * Knowledge-graph entity declarations, each grounded in a stated fact.
 * Unlike Coralina, Modeva's developer IS stated (Title, by the canonical
 * seed), so a developer entity is declared. No amenity entities exist —
 * no committed artifact states Modeva amenities — and no unit_type entities
 * are declared (a vocabulary is stated, but by a single source only).
 */
const MODEVA_ENTITIES: readonly KnowledgeEntityDeclaration[] = [
  {
    kind: "developer",
    slug: "title",
    name: "Title",
    refs: [
      { factId: MODEVA_DEVELOPER_SEED_FACT.id, sourceId: MODEVA_DEVELOPER_SEED_FACT.sourceId },
    ],
  },
  {
    kind: "location",
    slug: "bang-tao",
    name: "Bang Tao",
    refs: [{ factId: MODEVA_AREA_SEED_FACT.id, sourceId: MODEVA_AREA_SEED_FACT.sourceId }],
  },
];

const MODEVA_RELATIONS: readonly KnowledgeRelationDeclaration[] = [
  {
    kind: "developed_by",
    from: { kind: "project", key: MODEVA_SLUG },
    to: { kind: "developer", key: "title" },
    refs: [
      { factId: MODEVA_DEVELOPER_SEED_FACT.id, sourceId: MODEVA_DEVELOPER_SEED_FACT.sourceId },
    ],
  },
  {
    kind: "located_in",
    from: { kind: "project", key: MODEVA_SLUG },
    to: { kind: "location", key: "bang-tao" },
    refs: [{ factId: MODEVA_AREA_SEED_FACT.id, sourceId: MODEVA_AREA_SEED_FACT.sourceId }],
  },
];

/** The complete Modeva definition for the RC5.1 engine. */
export const MODEVA_KNOWLEDGE_DEFINITION: ProjectKnowledgeDefinition = {
  identity: {
    projectSlug: MODEVA_SLUG,
    projectId: MODEVA_PROJECT_ID,
    projectName: "Modeva",
    describedAt: MODEVA_KNOWLEDGE_DESCRIBED_AT,
  },
  sources: MODEVA_KNOWLEDGE_SOURCES,
  planTargets: MODEVA_PLAN_TARGETS,
  facts: MODEVA_EXTRACTION_FACTS,
  gaps: MODEVA_EXPECTED_MISSING_PATHS,
  entities: MODEVA_ENTITIES,
  relations: MODEVA_RELATIONS,
  readinessProfile: MODEVA_READINESS_PROFILE,
  provenance: {
    mergeAuthor: "modeva-knowledge (RC5.1)",
    mergeReason: "Settle the Modeva statements that passed RC4.7 cross-source validation.",
    createdNote: "Modeva canonical record described from RC4.7-admitted committed statements.",
  },
  copy: {
    kicker: "Internal inspection — RC5.1 project knowledge",
    intro:
      "Committed Modeva statements run end-to-end through the Forever foundations: Project Sources (RC4.4) → Extraction Facts (RC4.5) → Cross-Source Validation (RC4.7) → Canonical Record (RC4.6) → Knowledge Graph (RC4.8) → Readiness (RC4.9). Modeva has no committed developer package — its facts come from the canonical seed migration, the reviewed price-list import migration, and the real-run verification report. Missing and disputed information is shown, not filled in.",
    sourcesNote:
      "The committed repository artifacts Modeva's facts are stated from. No brochure, master-plan, unit-plan, amenity, rental, or legal artifact is committed for Modeva — none is registered.",
    missingNote:
      "Fields Modeva's committed artifacts genuinely do not state. Each is declared to RC4.7 and reported as an explicit missing_information finding — never given a placeholder value.",
    readinessNote:
      "Modeva is live in the product database, yet its committed knowledge package would not pass the Forever intake bar: the required developer brochure was never committed. That is the finding, not an error.",
    footer:
      'This page is a deterministic inspection of committed repository data (supabase/migrations FDB-001/FDB-002C and the FDB-002D/FDB-003C reports). It performs no network calls, reads no database, and fabricates no values: facts absent from the artifacts appear under "Missing information", and conflicting statements would appear under "Disputed information" unresolved.',
  },
};
