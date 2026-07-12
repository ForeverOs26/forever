/**
 * Project Knowledge inspection (RC5.1) — the application-facing view of one
 * project's run through the RC4.4–RC4.9 chain.
 *
 * Derives a plain, serialisable view-model from {@link ProjectKnowledgeSlice}
 * so the existing Forever application can render the chain's result without
 * importing foundation internals. Every row preserves traceability (fact ids,
 * source ids, pages, excerpts) and honesty (consensus, standings, withheld
 * facts, disputes, and missing information are shown exactly as the
 * foundations judged them — nothing is smoothed over for display).
 *
 * This is the RC5.0 Coralina inspection generalised; the row shapes are
 * unchanged, only the project-specific wording moved into the definition's
 * stated {@link ProjectKnowledgeCopy}.
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

import type { ProjectKnowledgeCopy } from "./definition";
import type { ProjectKnowledgeSlice } from "./slice";

export interface ProjectKnowledgeChainStageRow {
  rc: string;
  title: string;
  summary: string;
  ok: boolean;
}

export interface ProjectKnowledgeSourceRow {
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

export interface ProjectKnowledgeFactRow {
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

export interface ProjectKnowledgeFieldRow {
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

export interface ProjectKnowledgeDisputeClaimRow {
  factId: string;
  sourceId: string;
  display: string;
}

export interface ProjectKnowledgeDisputeRow {
  subjectKey: string;
  fieldPath?: string;
  findingIds: string[];
  claims: ProjectKnowledgeDisputeClaimRow[];
}

export interface ProjectKnowledgeMissingRow {
  path: string;
  reason: string;
  findingIds: string[];
}

export interface ProjectKnowledgeWithheldRow {
  factId: string;
  fieldPath?: string;
  admissibility: string;
  findingIds: string[];
}

export interface ProjectKnowledgeFindingRow {
  id: string;
  kind: string;
  disposition: string;
  path?: string;
  message: string;
}

export interface ProjectKnowledgeGraphSummary {
  id: string;
  nodeCount: number;
  edgeCount: number;
  factCount: number;
  sourceCount: number;
  claimCount: number;
  unresolvedCount: number;
  reviewClaims: { key: string; subjectKey?: string; standing?: string }[];
}

export interface ProjectKnowledgeReadinessRow {
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

export interface ProjectKnowledgeReadinessSummary {
  reportId: string;
  profileName: string;
  standing: string;
  blockers: ProjectKnowledgeReadinessRow[];
  advisories: ProjectKnowledgeReadinessRow[];
  evaluations: ProjectKnowledgeReadinessRow[];
}

/** Serialisable, application-facing view of one project's RC4.4→RC4.9 result. */
export interface ProjectKnowledgeInspection {
  projectSlug: string;
  projectId: string;
  projectName: string;
  describedAt: string;
  chain: ProjectKnowledgeChainStageRow[];
  sources: ProjectKnowledgeSourceRow[];
  facts: ProjectKnowledgeFactRow[];
  fields: ProjectKnowledgeFieldRow[];
  disputes: ProjectKnowledgeDisputeRow[];
  withheld: ProjectKnowledgeWithheldRow[];
  missing: ProjectKnowledgeMissingRow[];
  findings: ProjectKnowledgeFindingRow[];
  graph: ProjectKnowledgeGraphSummary;
  readiness: ProjectKnowledgeReadinessSummary;
  /** Page copy stated by the definition; absent fields use generic defaults. */
  copy?: ProjectKnowledgeCopy;
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

function evaluationRow(evaluation: ReadinessEvaluation): ProjectKnowledgeReadinessRow {
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
export function describeProjectKnowledgeInspection(
  slice: ProjectKnowledgeSlice,
  copy?: ProjectKnowledgeCopy,
): ProjectKnowledgeInspection {
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

  const chain: ProjectKnowledgeChainStageRow[] = [
    {
      rc: "RC4.4",
      title: "Project Sources",
      summary: `${slice.sources.definitions.length} source artifacts registered from the project's committed package; ${sourceIssueCount} validation issues.`,
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

  const sources: ProjectKnowledgeSourceRow[] = slice.sources.definitions.map((definition) => ({
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

  const facts: ProjectKnowledgeFactRow[] = slice.extraction.facts.map((fact) => ({
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

  const fields: ProjectKnowledgeFieldRow[] = sortProjectFields(slice.canonical.record.fields).map(
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

  const disputes: ProjectKnowledgeDisputeRow[] = report.subjects
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

  const withheld: ProjectKnowledgeWithheldRow[] = slice.canonical.withheld.map((entry) => ({
    factId: entry.standing.factId,
    fieldPath: entry.fieldPath,
    admissibility: entry.standing.admissibility,
    findingIds: [...entry.standing.findingIds],
  }));

  const missing: ProjectKnowledgeMissingRow[] = slice.gaps.map((gap) => ({
    path: gap.path,
    reason: gap.reason,
    findingIds: report.findings
      .filter((finding) => finding.kind === "missing_information" && finding.path === gap.path)
      .map((finding) => finding.id),
  }));

  const findings: ProjectKnowledgeFindingRow[] = report.findings.map((finding) => ({
    id: finding.id,
    kind: finding.kind,
    disposition: finding.disposition,
    path: finding.path,
    message: finding.message,
  }));

  const graphMetadata = slice.knowledgeGraph.result.metadata;
  const graph: ProjectKnowledgeGraphSummary = {
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
  const readiness: ProjectKnowledgeReadinessSummary = {
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
    // Shallow copy is a full defence here: the copy fields are all strings.
    ...(copy !== undefined ? { copy: { ...copy } } : {}),
  };
}
