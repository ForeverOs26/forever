/**
 * Coralina knowledge inspection — the application-facing view of the RC5.0
 * vertical slice.
 *
 * Derives a plain, serialisable view-model from {@link CoralinaKnowledgeSlice}
 * so the existing Forever application can render the chain's result without
 * importing foundation internals. Every row preserves traceability (fact ids,
 * source ids, pages, excerpts) and honesty (consensus, standings, withheld
 * facts, disputes, and missing information are shown exactly as the
 * foundations judged them — nothing is smoothed over for display).
 */

import {
  listCrossValidationFindingsRequiringReview,
  type CrossValidationAssessment,
} from "@/features/forever-cross-validation";
import {
  currentProjectFieldValue,
  findProjectField,
  sortProjectFields,
  type ProjectFieldValue,
} from "@/features/forever-project-database";
import { formatProjectSourceVersion } from "@/features/forever-project-sources";
import {
  knowledgeStandingForConsensus,
  listKnowledgeClaimsRequiringReview,
} from "@/features/forever-knowledge-graph";
import {
  listReadinessAdvisories,
  listReadinessBlockers,
  readinessRequirementSubject,
  type ReadinessEvaluation,
} from "@/features/forever-project-readiness";
import type {
  ExtractionFact,
  ExtractionStructuredValue,
} from "@/features/forever-extraction-pipeline";

import { buildCoralinaKnowledgeSlice, type CoralinaKnowledgeSlice } from "./slice";

export interface CoralinaChainStageRow {
  rc: string;
  title: string;
  summary: string;
  ok: boolean;
}

export interface CoralinaSourceRow {
  id: string;
  name: string;
  documentType: string;
  fileFormat: string;
  version: string;
  authorityKind: string;
  trust: string;
  status: string;
  documentDate?: string;
  artifact?: string;
}

export interface CoralinaFactRow {
  id: string;
  factType: string;
  fieldPath?: string;
  display: string;
  confidence: string;
  sourceId: string;
  locator?: string;
  excerpt?: string;
  admissibility: string;
}

export interface CoralinaFieldRow {
  path: string;
  section: string;
  name: string;
  display: string;
  confidence: string;
  factId?: string;
  sourceIds: string[];
  supportingSourceIds: string[];
  consensus?: string;
  standing?: string;
  locator?: string;
  excerpt?: string;
}

export interface CoralinaDisputeClaimRow {
  factId: string;
  sourceId: string;
  display: string;
}

export interface CoralinaDisputeRow {
  subjectKey: string;
  fieldPath?: string;
  findingIds: string[];
  claims: CoralinaDisputeClaimRow[];
}

export interface CoralinaMissingRow {
  path: string;
  reason: string;
  findingIds: string[];
}

export interface CoralinaWithheldRow {
  factId: string;
  fieldPath?: string;
  admissibility: string;
  findingIds: string[];
}

export interface CoralinaFindingRow {
  id: string;
  kind: string;
  disposition: string;
  path?: string;
  message: string;
}

export interface CoralinaGraphSummary {
  id: string;
  nodeCount: number;
  edgeCount: number;
  factCount: number;
  sourceCount: number;
  claimCount: number;
  unresolvedCount: number;
  reviewClaims: { key: string; subjectKey?: string; standing?: string }[];
}

export interface CoralinaReadinessRow {
  id: string;
  kind: string;
  subject: string;
  necessity: string;
  verdict: string;
  reason: string;
  standing?: string;
  referenceCount: number;
  findingIds: string[];
}

export interface CoralinaReadinessSummary {
  reportId: string;
  profileName: string;
  standing: string;
  blockers: CoralinaReadinessRow[];
  advisories: CoralinaReadinessRow[];
  evaluations: CoralinaReadinessRow[];
}

/** Serialisable, application-facing view of the Coralina RC4.4→RC4.9 result. */
export interface CoralinaKnowledgeInspection {
  projectSlug: string;
  projectId: string;
  projectName: string;
  describedAt: string;
  chain: CoralinaChainStageRow[];
  sources: CoralinaSourceRow[];
  facts: CoralinaFactRow[];
  fields: CoralinaFieldRow[];
  disputes: CoralinaDisputeRow[];
  withheld: CoralinaWithheldRow[];
  missing: CoralinaMissingRow[];
  findings: CoralinaFindingRow[];
  graph: CoralinaGraphSummary;
  readiness: CoralinaReadinessSummary;
}

function displayValue(rawValue?: string, structuredValue?: ExtractionStructuredValue): string {
  if (rawValue !== undefined) return rawValue;
  if (structuredValue === undefined) return "(no value)";
  if (Array.isArray(structuredValue)) return structuredValue.map(String).join("; ");
  if (typeof structuredValue === "object") return JSON.stringify(structuredValue);
  return String(structuredValue);
}

function displayFieldValue(value: ProjectFieldValue | undefined): string {
  if (!value) return "(no value)";
  return displayValue(value.rawValue, value.structuredValue);
}

function displayLocator(fact: ExtractionFact | undefined): string | undefined {
  const locator = fact?.evidence.locator;
  if (!locator) return undefined;
  const parts = [
    locator.kind === "page" && locator.page !== undefined ? `p.${locator.page}` : locator.kind,
  ];
  if (locator.detail) parts.push(locator.detail);
  return parts.join(" — ");
}

function evaluationRow(evaluation: ReadinessEvaluation): CoralinaReadinessRow {
  return {
    id: evaluation.id,
    kind: evaluation.requirement.kind,
    subject: readinessRequirementSubject(evaluation.requirement),
    necessity: evaluation.requirement.necessity ?? "required",
    verdict: evaluation.verdict,
    reason: evaluation.reason,
    standing: evaluation.standing,
    referenceCount: evaluation.references.length,
    findingIds: [...(evaluation.findingIds ?? [])],
  };
}

/** Derive the application-facing inspection view from a built slice. */
export function describeCoralinaKnowledgeInspection(
  slice: CoralinaKnowledgeSlice,
): CoralinaKnowledgeInspection {
  const factsById = new Map(slice.extraction.facts.map((fact) => [fact.id, fact]));
  const admissibilityByFactId = new Map(
    slice.crossValidation.report.standings.map((standing) => [
      standing.factId,
      standing.admissibility,
    ]),
  );
  const report = slice.crossValidation.report;
  // First assessment per field path (subject keys are projectId:factType:path,
  // so two fact types could address one path — first match wins, explicitly).
  const assessmentsByFieldPath = new Map<string, CrossValidationAssessment>();
  for (const assessment of report.subjects) {
    const path = assessment.subject.fieldPath;
    if (path !== undefined && !assessmentsByFieldPath.has(path)) {
      assessmentsByFieldPath.set(path, assessment);
    }
  }
  const reviewFindingCount = listCrossValidationFindingsRequiringReview(report).length;
  const sourceIssueCount = slice.sources.validations.reduce(
    (total, validation) => total + validation.issues.length,
    0,
  );
  const recordErrorCount = slice.canonical.recordIssues.filter(
    (issue) => issue.severity === "error",
  ).length;

  const chain: CoralinaChainStageRow[] = [
    {
      rc: "RC4.4",
      title: "Project Sources",
      summary: `${slice.sources.definitions.length} source artifacts registered from the classified Coralina package; ${sourceIssueCount} validation issues.`,
      ok: sourceIssueCount === 0,
    },
    {
      rc: "RC4.5",
      title: "Extraction Facts",
      summary: `${slice.extraction.facts.length} source-backed facts stated across ${slice.extraction.plans.length} extraction plans.`,
      ok: slice.extraction.validation.valid && slice.extraction.plans.every((plan) => plan.ok),
    },
    {
      rc: "RC4.7",
      title: "Cross-Source Validation",
      summary: `${report.subjects.length} subjects assessed; ${report.findings.length} findings, ${reviewFindingCount} requiring review.`,
      ok: slice.crossValidation.result.ok,
    },
    {
      rc: "RC4.6",
      title: "Canonical Record",
      summary: `${slice.canonical.record.fields.length} canonical fields from ${slice.canonical.admittedFactIds.length} admitted facts; ${slice.canonical.withheld.length} facts withheld; ${slice.canonical.merge.conflicts.length} merge conflicts.`,
      ok: slice.canonical.mergeResult.ok && recordErrorCount === 0,
    },
    {
      rc: "RC4.8",
      title: "Knowledge Graph",
      summary: `${slice.knowledgeGraph.graph.nodes.length} nodes and ${slice.knowledgeGraph.graph.edges.length} edges over facts, claims, sources, and findings.`,
      ok: slice.knowledgeGraph.result.ok,
    },
    {
      rc: "RC4.9",
      title: "Project Readiness",
      summary: `Standing "${slice.readiness.report.standing}" against the caller-stated intake profile (${slice.readiness.report.evaluations.length} evaluations).`,
      ok: slice.readiness.result.ok,
    },
  ];

  const sources: CoralinaSourceRow[] = slice.sources.definitions.map((definition) => ({
    id: definition.identity.id,
    name: definition.identity.name,
    documentType: definition.descriptor.documentType,
    fileFormat: definition.descriptor.fileFormat,
    version: formatProjectSourceVersion(definition.version),
    authorityKind: definition.authority.kind,
    trust: definition.authority.trust,
    status: definition.status,
    documentDate: definition.descriptor.documentDate,
    artifact: definition.metadata?.description,
  }));

  const facts: CoralinaFactRow[] = slice.extraction.facts.map((fact) => ({
    id: fact.id,
    factType: fact.factType,
    fieldPath: fact.fieldPath,
    display: displayValue(fact.rawValue, fact.structuredValue),
    confidence: fact.confidence.level,
    sourceId: fact.sourceId,
    locator: displayLocator(fact),
    excerpt: fact.evidence.excerpt,
    admissibility: admissibilityByFactId.get(fact.id) ?? "unknown",
  }));

  const fields: CoralinaFieldRow[] = sortProjectFields(slice.canonical.record.fields).map(
    (field) => {
      const value = currentProjectFieldValue(field);
      const assessment = assessmentsByFieldPath.get(field.path);
      const fact = value?.factId ? factsById.get(value.factId) : undefined;
      return {
        path: field.path,
        section: field.section,
        name: field.name,
        display: displayFieldValue(value),
        confidence: value?.confidence.level ?? "unknown",
        factId: value?.factId,
        sourceIds: [...(value?.sourceIds ?? [])],
        supportingSourceIds: assessment
          ? [...new Set(assessment.readings.map((reading) => reading.sourceId))]
          : [],
        consensus: assessment?.consensus,
        standing: assessment ? knowledgeStandingForConsensus(assessment.consensus) : undefined,
        locator: displayLocator(fact),
        excerpt: fact?.evidence.excerpt,
      };
    },
  );

  const disputes: CoralinaDisputeRow[] = report.subjects
    .filter((subject) => subject.consensus === "contested")
    .map((subject) => ({
      subjectKey: subject.subject.key,
      fieldPath: subject.subject.fieldPath,
      findingIds: [...subject.findingIds],
      claims: subject.readings.map((reading) => {
        const fact = factsById.get(reading.factId);
        return {
          factId: reading.factId,
          sourceId: reading.sourceId,
          display: fact ? displayValue(fact.rawValue, fact.structuredValue) : "(unknown fact)",
        };
      }),
    }));

  const withheld: CoralinaWithheldRow[] = slice.canonical.withheld.map((entry) => ({
    factId: entry.standing.factId,
    fieldPath: entry.fieldPath,
    admissibility: entry.standing.admissibility,
    findingIds: [...entry.standing.findingIds],
  }));

  const missing: CoralinaMissingRow[] = slice.gaps.map((gap) => ({
    path: gap.path,
    reason: gap.reason,
    findingIds: report.findings
      .filter((finding) => finding.kind === "missing_information" && finding.path === gap.path)
      .map((finding) => finding.id),
  }));

  const findings: CoralinaFindingRow[] = report.findings.map((finding) => ({
    id: finding.id,
    kind: finding.kind,
    disposition: finding.disposition,
    path: finding.path,
    message: finding.message,
  }));

  const graphMetadata = slice.knowledgeGraph.result.metadata;
  const graph: CoralinaGraphSummary = {
    id: slice.knowledgeGraph.graph.id,
    nodeCount: graphMetadata.nodeCount,
    edgeCount: graphMetadata.edgeCount,
    factCount: graphMetadata.factCount,
    sourceCount: graphMetadata.sourceCount,
    claimCount: graphMetadata.claimCount,
    unresolvedCount: graphMetadata.unresolvedCount,
    reviewClaims: listKnowledgeClaimsRequiringReview(slice.knowledgeGraph.graph).map((claim) => ({
      key: claim.key,
      subjectKey: claim.subjectKey,
      standing: claim.standing,
    })),
  };

  const readinessReport = slice.readiness.report;
  const readiness: CoralinaReadinessSummary = {
    reportId: readinessReport.id,
    profileName: slice.readiness.profile.name,
    standing: readinessReport.standing,
    blockers: listReadinessBlockers(readinessReport).map(evaluationRow),
    advisories: listReadinessAdvisories(readinessReport).map(evaluationRow),
    evaluations: readinessReport.evaluations.map(evaluationRow),
  };

  const nameField = findProjectField(slice.canonical.record, "general.name");
  const nameValue = nameField ? currentProjectFieldValue(nameField) : undefined;

  return {
    projectSlug: slice.projectSlug,
    projectId: slice.projectId,
    projectName: nameValue?.rawValue ?? slice.projectSlug,
    describedAt: slice.describedAt,
    chain,
    sources,
    facts,
    fields,
    disputes,
    withheld,
    missing,
    findings,
    graph,
    readiness,
  };
}

let cachedInspection: CoralinaKnowledgeInspection | undefined;

/**
 * The Coralina inspection view, built once per process. The slice is pure and
 * deterministic, so caching is safe and keeps route loads cheap. Each call
 * returns an independent deep copy: on the server one process serves many
 * requests, and a caller mutating shared loader data in place must never be
 * able to poison the cache for every later request.
 */
export function getCoralinaKnowledgeInspection(): CoralinaKnowledgeInspection {
  cachedInspection ??= describeCoralinaKnowledgeInspection(buildCoralinaKnowledgeSlice());
  return structuredClone(cachedInspection);
}
