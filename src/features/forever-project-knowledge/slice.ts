/**
 * The Project Knowledge engine (RC5.1) — one orchestration function that runs
 * any stated {@link ProjectKnowledgeDefinition} through the complete
 * RC4.4–RC4.9 foundation chain and returns every intermediate artifact for
 * inspection:
 *
 *   RC4.4 Project Sources        → registered source definitions
 *   RC4.5 Extraction Pipeline    → extraction plans + source-backed facts
 *   RC4.7 Cross-Source Validation→ report (consensus, findings, standings)
 *   RC4.6 Canonical Database     → merge + canonical record (admitted facts only)
 *   RC4.8 Knowledge Graph        → graph over facts, claims, and findings
 *   RC4.9 Project Readiness      → report against the caller-stated profile
 *
 * This is the RC5.0 Coralina orchestration generalised: the engine adds NO
 * parallel logic and NO project knowledge of its own. Every judgement
 * (agreement, conflict, admissibility, standing, verdict) is made by the
 * foundations; every project-specific statement comes from the definition.
 * The only decision the engine takes is the routing the RC4.7 contract
 * assigns to callers: facts whose standing is not `admissible` are withheld
 * from the canonical record and reported as withheld — never resolved
 * silently, never dropped invisibly.
 *
 * Everything is pure and deterministic: caller-stated clocks, no I/O, no
 * randomness. Building the same definition twice yields deep-equal results.
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
  ProjectSourceRegistry,
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
  type KnowledgeGraph,
  type KnowledgeGraphResult,
} from "@/features/forever-knowledge-graph";

import {
  validateProjectKnowledgeDefinition,
  type ProjectKnowledgeDefinition,
  type ProjectKnowledgeGap,
} from "./definition";

/** A fact RC4.7 kept out of the canonical record, with the reason preserved. */
export interface ProjectKnowledgeWithheldFact {
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
export interface ProjectKnowledgeSourceValidation {
  sourceId: string;
  issues: ProjectSourceIssue[];
}

/** The complete, inspectable result of one project's RC4.4→RC4.9 chain. */
export interface ProjectKnowledgeSlice {
  projectSlug: string;
  projectId: string;
  describedAt: string;
  sources: {
    definitions: ProjectSourceDefinition[];
    validations: ProjectKnowledgeSourceValidation[];
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
    withheld: ProjectKnowledgeWithheldFact[];
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
  gaps: ProjectKnowledgeGap[];
}

/** Invariant guard: the foundations returned no artifact for a stage that must produce one. */
function expectArtifact<T>(artifact: T | undefined, projectSlug: string, stage: string): T {
  if (artifact === undefined) {
    throw new Error(`Project knowledge slice (${projectSlug}): ${stage} produced no artifact`);
  }
  return artifact;
}

/**
 * Run one stated project definition through the complete RC4.4→RC4.9 chain.
 *
 * Pure and deterministic — the same definition yields the same slice on
 * every call.
 */
export function buildProjectKnowledgeSlice(
  definition: ProjectKnowledgeDefinition,
): ProjectKnowledgeSlice {
  const { identity, provenance } = definition;
  const projectSlug = identity.projectSlug;
  const now = identity.describedAt;

  // Gate on the stated definition's structural validity. This is the one
  // check the foundations cannot make for the caller: RC4.7 silently skips
  // an expected path that a fact also states, so a definition declaring a
  // path both stated and missing would render a self-contradicting
  // inspection instead of failing anywhere.
  const definitionIssues = validateProjectKnowledgeDefinition(definition);
  if (definitionIssues.length > 0) {
    const detail = definitionIssues
      .map((issue) => `${issue.path ?? "(definition)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Project knowledge slice (${projectSlug}): malformed definition — ${detail}`);
  }

  // RC4.4 — register the stated sources; the registry throws on duplicate ids.
  const registry = new ProjectSourceRegistry();
  for (const source of definition.sources) {
    registry.register(source);
  }
  const definitions = [...definition.sources];
  const validations: ProjectKnowledgeSourceValidation[] = definitions.map((source) => ({
    sourceId: source.identity.id,
    issues: validateProjectSourceDefinition(source),
  }));

  // RC4.5 — plan extraction per source and validate the stated facts.
  const pipeline = buildForeverExtractionPipeline();
  const plans = definition.planTargets.map(({ source, factTypes }) =>
    planExtraction({ definition: pipeline, now }, { source, factTypes }),
  );
  const facts = [...definition.facts];
  const factsValidation = validateExtractionFacts(facts);

  // RC4.7 — cross-source validation, with the known-missing paths declared so
  // absent information is judged explicitly instead of being ignored.
  const crossResult = describeCrossSourceValidation(
    {
      sources: definitions,
      requirements: { expectedPaths: definition.gaps.map((gap) => gap.path) },
      now,
    },
    { projectSlug, facts },
  );
  const report = expectArtifact(crossResult.data[0], projectSlug, "cross-source validation");

  // RC4.7 → RC4.6 admissibility routing (the caller-side act the RC4.7
  // contract defines): only admissible facts enter the canonical record.
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  const admitted = listCrossFactStandings(report.standings, "admissible").map((standing) =>
    expectArtifact(factsById.get(standing.factId), projectSlug, "admitted fact lookup"),
  );
  const withheld: ProjectKnowledgeWithheldFact[] = report.standings
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
    projectSlug,
    name: identity.projectName,
    version: projectRecordVersion(1, 0, 0),
    status: "draft",
  } as const;
  const baseRecord = describeProjectRecord({ ...recordBase });
  const mergeResult = describeProjectMerge(
    { record: baseRecord, now },
    {
      facts: admitted,
      author: provenance.mergeAuthor,
      reason: provenance.mergeReason,
    },
  );
  const merge = expectArtifact(mergeResult.data[0], projectSlug, "canonical merge");

  const recordSourceIds = distinctCrossSourceRefs(admitted);
  const recordDraft = describeProjectRecord({
    ...recordBase,
    fields: merge.mergedFields,
    revisions: [merge.revision],
    sourceIds: recordSourceIds,
  });
  const snapshot = describeProjectSnapshot(recordDraft, merge.revision, { takenAt: now });

  let timeline = emptyProjectTimeline(identity.projectId);
  timeline = appendProjectTimelineEvent(
    timeline,
    projectTimelineEvent("created", {
      occurredAt: now,
      description: provenance.createdNote,
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
      projectSlug,
      facts,
      entities: [...definition.entities],
      relations: [...definition.relations],
    },
  );
  const graph = expectArtifact(graphResult.data[0], projectSlug, "knowledge graph");

  // RC4.9 — readiness against the caller-stated intake profile.
  const readinessResult = describeProjectReadiness(
    { sources: definitions, record, report, now },
    { projectSlug, profile: definition.readinessProfile },
  );
  const readinessReport = expectArtifact(readinessResult.data[0], projectSlug, "readiness");

  return {
    projectSlug,
    projectId: identity.projectId,
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
      profile: definition.readinessProfile,
      result: readinessResult,
      report: readinessReport,
    },
    gaps: [...definition.gaps],
  };
}
