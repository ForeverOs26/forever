/**
 * The Coralina end-to-end vertical slice (RC5.0) — one orchestration function
 * that runs real Coralina data through the complete RC4.4–RC4.9 foundation
 * chain and returns every intermediate artifact for inspection:
 *
 *   RC4.4 Project Sources        → registered source definitions
 *   RC4.5 Extraction Pipeline    → extraction plans + source-backed facts
 *   RC4.7 Cross-Source Validation→ report (consensus, findings, standings)
 *   RC4.6 Canonical Database     → merge + canonical record (admitted facts only)
 *   RC4.8 Knowledge Graph        → graph over facts, claims, and findings
 *   RC4.9 Project Readiness      → report against the caller-stated profile
 *
 * The slice adds NO parallel logic: every judgement (agreement, conflict,
 * admissibility, standing, verdict) is made by the foundations themselves.
 * The only decision this module takes is the routing the RC4.7 contract
 * assigns to callers: facts whose standing is not `admissible` are withheld
 * from the canonical record and reported as withheld — never resolved
 * silently, never dropped invisibly.
 *
 * Everything is pure and deterministic: fixed caller-stated clocks, no I/O,
 * no randomness. Building the slice twice yields deep-equal results.
 */

import {
  describeCrossSourceValidation,
  distinctCrossSourceRefs,
  listCrossFactStandings,
  type CrossFactStanding,
  type CrossValidationReport,
  type CrossValidationResult,
} from "@/features/forever-cross-validation";
import {
  buildForeverExtractionPipeline,
  planExtraction,
  validateExtractionFacts,
  type ExtractionDefinition,
  type ExtractionFact,
  type ExtractionFactType,
  type ExtractionFactsValidation,
  type ExtractionPlan,
  type ExtractionResult,
} from "@/features/forever-extraction-pipeline";
import {
  appendProjectTimelineEvent,
  describeProjectMerge,
  describeProjectRecord,
  describeProjectSnapshot,
  emptyProjectTimeline,
  projectRecordVersion,
  projectTimelineEvent,
  validateProjectRecord,
  type ProjectDatabaseIssue,
  type ProjectMerge,
  type ProjectRecord,
  type ProjectResult,
} from "@/features/forever-project-database";
import {
  validateProjectSourceDefinition,
  type ProjectSourceDefinition,
  type ProjectSourceIssue,
} from "@/features/forever-project-sources";
import {
  describeProjectReadiness,
  type ReadinessProfile,
  type ReadinessReport,
  type ReadinessResult,
} from "@/features/forever-project-readiness";
import {
  describeKnowledgeGraph,
  type KnowledgeEntityDeclaration,
  type KnowledgeGraph,
  type KnowledgeGraphResult,
  type KnowledgeRelationDeclaration,
} from "@/features/forever-knowledge-graph";
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
  type CoralinaKnowledgeGap,
} from "./facts";
import {
  buildCoralinaKnowledgeSourceRegistry,
  CORALINA_BROCHURE_SOURCE,
  CORALINA_FACILITIES_SOURCE,
  CORALINA_KNOWLEDGE_SOURCES,
  CORALINA_LOCATION_MAP_SOURCE,
  CORALINA_MASTER_PLAN_SOURCE,
  CORALINA_PRICE_LIST_SOURCE,
  CORALINA_UNIT_PLANS_SOURCE,
} from "./sources";
import { CORALINA_READINESS_PROFILE } from "./profile";

/** A fact RC4.7 kept out of the canonical record, with the reason preserved. */
export interface CoralinaWithheldFact {
  /**
   * The RC4.7 standing, verbatim (never "admissible" — admissible facts are
   * merged, not withheld). Keeping the foundation's own shape means any field
   * RC4.7 adds later flows through without this module re-modelling it.
   */
  standing: CrossFactStanding;
  /** The withheld fact's field path, for display and lookup. */
  fieldPath?: string;
}

/** Per-source RC4.4 validation outcome. */
export interface CoralinaSourceValidation {
  sourceId: string;
  issues: ProjectSourceIssue[];
}

/** The complete, inspectable result of the Coralina RC4.4→RC4.9 chain. */
export interface CoralinaKnowledgeSlice {
  projectSlug: string;
  projectId: string;
  describedAt: string;
  sources: {
    definitions: ProjectSourceDefinition[];
    validations: CoralinaSourceValidation[];
  };
  extraction: {
    pipeline: ExtractionDefinition;
    plans: ExtractionResult<ExtractionPlan>[];
    facts: ExtractionFact[];
    validation: ExtractionFactsValidation;
  };
  crossValidation: {
    result: CrossValidationResult<CrossValidationReport>;
    report: CrossValidationReport;
  };
  canonical: {
    mergeResult: ProjectResult<ProjectMerge>;
    merge: ProjectMerge;
    record: ProjectRecord;
    recordIssues: ProjectDatabaseIssue[];
    admittedFactIds: string[];
    withheld: CoralinaWithheldFact[];
  };
  knowledgeGraph: {
    result: KnowledgeGraphResult<KnowledgeGraph>;
    graph: KnowledgeGraph;
  };
  readiness: {
    profile: ReadinessProfile;
    result: ReadinessResult<ReadinessReport>;
    report: ReadinessReport;
  };
  gaps: CoralinaKnowledgeGap[];
}

/** Extraction plan targets per source — only fact types this slice actually states. */
const CORALINA_PLAN_TARGETS: readonly {
  source: ProjectSourceDefinition;
  factTypes: ExtractionFactType[];
}[] = [
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

/** Invariant guard: the foundations returned no artifact for a stage that must produce one. */
function expectArtifact<T>(artifact: T | undefined, stage: string): T {
  if (artifact === undefined) {
    throw new Error(`Coralina knowledge slice: ${stage} produced no artifact`);
  }
  return artifact;
}

/**
 * Run real Coralina data through the complete RC4.4→RC4.9 chain.
 *
 * Pure and deterministic — same output on every call.
 */
export function buildCoralinaKnowledgeSlice(): CoralinaKnowledgeSlice {
  const now = CORALINA_KNOWLEDGE_DESCRIBED_AT;

  // RC4.4 — register the real sources; the registry throws on duplicate ids.
  buildCoralinaKnowledgeSourceRegistry();
  const definitions = [...CORALINA_KNOWLEDGE_SOURCES];
  const validations: CoralinaSourceValidation[] = definitions.map((definition) => ({
    sourceId: definition.identity.id,
    issues: validateProjectSourceDefinition(definition),
  }));

  // RC4.5 — plan extraction per source and validate the stated facts.
  const pipeline = buildForeverExtractionPipeline();
  const plans = CORALINA_PLAN_TARGETS.map(({ source, factTypes }) =>
    planExtraction({ definition: pipeline, now }, { source, factTypes }),
  );
  const facts = [...CORALINA_EXTRACTION_FACTS];
  const factsValidation = validateExtractionFacts(facts);

  // RC4.7 — cross-source validation, with the known-missing paths declared so
  // absent information is judged explicitly instead of being ignored.
  const crossResult = describeCrossSourceValidation(
    {
      sources: definitions,
      requirements: { expectedPaths: CORALINA_EXPECTED_MISSING_PATHS.map((gap) => gap.path) },
      now,
    },
    { projectSlug: CORALINA_SLUG, facts },
  );
  const report = expectArtifact(crossResult.data[0], "cross-source validation");

  // RC4.7 → RC4.6 admissibility routing (the caller-side act the RC4.7
  // contract defines): only admissible facts enter the canonical record.
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  const admitted = listCrossFactStandings(report.standings, "admissible").map((standing) =>
    expectArtifact(factsById.get(standing.factId), "admitted fact lookup"),
  );
  const withheld: CoralinaWithheldFact[] = report.standings
    .filter((standing) => standing.admissibility !== "admissible")
    .map((standing) => ({
      // Deep copy so the slice never exposes one mutable object at two paths
      // (mirrors the foundations' own anti-aliasing convention).
      standing: structuredClone(standing),
      fieldPath: factsById.get(standing.factId)?.fieldPath,
    }));

  // RC4.6 — merge the admitted facts into a fresh canonical record. All three
  // record descriptions share one identity statement so they cannot drift.
  const recordBase = {
    projectSlug: CORALINA_SLUG,
    name: CORALINA_PROJECT_NAME.value,
    version: projectRecordVersion(1, 0, 0),
    status: "draft",
  } as const;
  const baseRecord = describeProjectRecord({ ...recordBase });
  const mergeResult = describeProjectMerge(
    { record: baseRecord, now },
    {
      facts: admitted,
      author: "coralina-knowledge (RC5.0)",
      reason: "Settle the Coralina extraction facts that passed RC4.7 cross-source validation.",
    },
  );
  const merge = expectArtifact(mergeResult.data[0], "canonical merge");

  const recordSourceIds = distinctCrossSourceRefs(admitted);
  const recordDraft = describeProjectRecord({
    ...recordBase,
    fields: merge.mergedFields,
    revisions: [merge.revision],
    sourceIds: recordSourceIds,
  });
  const snapshot = describeProjectSnapshot(recordDraft, merge.revision, { takenAt: now });

  let timeline = emptyProjectTimeline(CORALINA_PROJECT_ID);
  timeline = appendProjectTimelineEvent(
    timeline,
    projectTimelineEvent("created", {
      occurredAt: now,
      description: "Coralina canonical record described from RC4.7-admitted extraction facts.",
    }),
  );
  timeline = appendProjectTimelineEvent(
    timeline,
    projectTimelineEvent("merge", { mergeId: merge.id, occurredAt: now }),
  );
  timeline = appendProjectTimelineEvent(
    timeline,
    projectTimelineEvent("revision", { revisionId: merge.revision.id, occurredAt: now }),
  );
  timeline = appendProjectTimelineEvent(
    timeline,
    projectTimelineEvent("snapshot", { snapshotId: snapshot.id, occurredAt: now }),
  );

  const record = describeProjectRecord({
    ...recordBase,
    fields: merge.mergedFields,
    revisions: [merge.revision],
    snapshots: [snapshot],
    timeline,
    sourceIds: recordSourceIds,
  });
  const recordIssues = validateProjectRecord(record);

  // RC4.8 — the knowledge graph sees ALL facts (including withheld ones), the
  // record, the merge, and the RC4.7 report, so disputed claims stay visible.
  const graphResult = describeKnowledgeGraph(
    { sources: definitions, record, merge, report, now },
    {
      projectSlug: CORALINA_SLUG,
      facts,
      entities: coralinaEntityDeclarations(),
      relations: coralinaRelationDeclarations(),
    },
  );
  const graph = expectArtifact(graphResult.data[0], "knowledge graph");

  // RC4.9 — readiness against the caller-stated intake profile.
  const readinessResult = describeProjectReadiness(
    { sources: definitions, record, report, now },
    { projectSlug: CORALINA_SLUG, profile: CORALINA_READINESS_PROFILE },
  );
  const readinessReport = expectArtifact(readinessResult.data[0], "readiness");

  return {
    projectSlug: CORALINA_SLUG,
    projectId: CORALINA_PROJECT_ID,
    describedAt: now,
    sources: { definitions, validations },
    extraction: { pipeline, plans, facts, validation: factsValidation },
    crossValidation: { result: crossResult, report },
    canonical: {
      mergeResult,
      merge,
      record,
      recordIssues,
      admittedFactIds: admitted.map((fact) => fact.id),
      withheld,
    },
    knowledgeGraph: { result: graphResult, graph },
    readiness: {
      profile: CORALINA_READINESS_PROFILE,
      result: readinessResult,
      report: readinessReport,
    },
    gaps: [...CORALINA_EXPECTED_MISSING_PATHS],
  };
}
