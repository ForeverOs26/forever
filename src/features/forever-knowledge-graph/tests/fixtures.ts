/**
 * Forever Knowledge Graph — shared test fixtures.
 *
 * Deterministic builders for RC4.4 registered sources, RC4.5 extracted facts,
 * an RC4.6 canonical record and described merge, an RC4.7 cross-source
 * validation report, caller declarations, contexts, requests, and described
 * graphs. Every builder takes a partial override so tests state only what
 * they exercise, and the defaults describe the Coralina price examined across
 * the same catalogued price list the RC4.4/RC4.5/RC4.6/RC4.7 fixtures speak
 * about plus an independent brochure — so the fixtures double as
 * documentation of the RC4.4 → RC4.5 → RC4.7 → RC4.6 → RC4.8 chain.
 */

import type { CrossValidationReport } from "@/features/forever-cross-validation";
import { describeCrossSourceValidation } from "@/features/forever-cross-validation";
import {
  describeExtractionFact,
  extractionMethod,
  type DescribeExtractionFactInput,
  type ExtractionFact,
} from "@/features/forever-extraction-pipeline";
import {
  describeProjectField,
  describeProjectMerge,
  describeProjectRecord,
  describeProjectRevision,
  projectFieldValueFromFact,
  projectRecordVersion,
  type ProjectMerge,
  type ProjectRecord,
} from "@/features/forever-project-database";
import {
  describeProjectSource,
  projectSourceAuthority,
  projectSourceRelationships,
  projectSourceVersion,
  type DescribeProjectSourceInput,
  type ProjectSourceDefinition,
} from "@/features/forever-project-sources";

import type { KnowledgeGraphContext } from "../context";
import type { KnowledgeEntityDeclaration, KnowledgeRelationDeclaration } from "../declaration";
import type { KnowledgeGraph, KnowledgeGraphRequest } from "../graph";
import { describeKnowledgeGraph } from "../graph";
import type { KnowledgeGraphResult } from "../result";

/** The deterministic caller clock every default context supplies. */
export const NOW = "2026-07-12T00:00:00.000Z";

/** The reused RC4.5 subject key of the default base-price statement. */
export const PRICE_SUBJECT = "proj_coralina:price:pricing.basePrice";

/** The RC4.4 catalogued price list the default facts trace to. */
export const PRICE_LIST_ID = "psrc_coralina-price-list-v1-0-0";

/** An independent RC4.4 catalogued brochure. */
export const BROCHURE_ID = "psrc_coralina-brochure-v1-0-0";

/** A translation of the brochure — related, therefore not independent of it. */
export const TRANSLATION_ID = "psrc_coralina-brochure-th-v1-0-0";

/** The registered price list definition (revision 1.0.0). */
export function makePriceListSource(
  overrides: Partial<DescribeProjectSourceInput> = {},
): ProjectSourceDefinition {
  return describeProjectSource({
    projectSlug: "coralina",
    sourceSlug: "price-list",
    documentType: "price_list",
    fileFormat: "pdf",
    version: projectSourceVersion(1, 0, 0),
    authority: projectSourceAuthority("developer_official"),
    status: "verified",
    origin: "developer_website",
    ...overrides,
  });
}

/** The independent registered brochure definition. */
export function makeBrochureSource(
  overrides: Partial<DescribeProjectSourceInput> = {},
): ProjectSourceDefinition {
  return describeProjectSource({
    projectSlug: "coralina",
    sourceSlug: "brochure",
    documentType: "brochure",
    fileFormat: "pdf",
    version: projectSourceVersion(1, 0, 0),
    authority: projectSourceAuthority("agency"),
    status: "verified",
    origin: "marketplace",
    ...overrides,
  });
}

/** The registered Thai translation of the brochure — dependent on it. */
export function makeTranslationSource(
  overrides: Partial<DescribeProjectSourceInput> = {},
): ProjectSourceDefinition {
  return describeProjectSource({
    projectSlug: "coralina",
    sourceSlug: "brochure-th",
    documentType: "brochure",
    fileFormat: "pdf",
    version: projectSourceVersion(1, 0, 0),
    authority: projectSourceAuthority("agency"),
    status: "verified",
    origin: "marketplace",
    relationships: projectSourceRelationships({ translationOf: BROCHURE_ID }),
    ...overrides,
  });
}

/** The default registered sources: price list and independent brochure. */
export function makeSources(): ProjectSourceDefinition[] {
  return [makePriceListSource(), makeBrochureSource()];
}

/** The RC4.5 describe input for the default price-list base-price fact. */
export function makeFactInput(
  overrides: Partial<DescribeExtractionFactInput> = {},
): DescribeExtractionFactInput {
  return {
    projectSlug: "coralina",
    factSlug: "price-1br",
    factType: "price",
    sourceId: PRICE_LIST_ID,
    sourceVersion: projectSourceVersion(1, 0, 0),
    method: extractionMethod("manual", { description: "Read off the printed price table." }),
    extractedAt: "2026-02-01T00:00:00.000Z",
    fieldPath: "pricing.basePrice",
    rawValue: "THB 4,590,000",
    structuredValue: { amount: 4590000, currency: "THB" },
    language: "en",
    confidence: { level: "high", score: 0.9 },
    locator: { kind: "page", page: 3, detail: "price table, row 1BR" },
    excerpt: "1BR — THB 4,590,000",
    ...overrides,
  };
}

/** A fully described RC4.5 fact, with input overrides applied shallowly. */
export function makeFact(overrides: Partial<DescribeExtractionFactInput> = {}): ExtractionFact {
  return describeExtractionFact(makeFactInput(overrides));
}

/** The same base-price reading stated by the independent brochure. */
export function makeAgreeingFact(
  overrides: Partial<DescribeExtractionFactInput> = {},
): ExtractionFact {
  return makeFact({
    factSlug: "price-1br-brochure",
    sourceId: BROCHURE_ID,
    excerpt: "One-bedroom from THB 4,590,000",
    locator: { kind: "page", page: 12 },
    ...overrides,
  });
}

/** A disagreeing base-price reading stated by the independent brochure. */
export function makeConflictingFact(
  overrides: Partial<DescribeExtractionFactInput> = {},
): ExtractionFact {
  return makeAgreeingFact({
    rawValue: "THB 4,790,000",
    structuredValue: { amount: 4790000, currency: "THB" },
    excerpt: "One-bedroom from THB 4,790,000",
    ...overrides,
  });
}

/** A developer-name reading stated by the brochure. */
export function makeDeveloperFact(
  overrides: Partial<DescribeExtractionFactInput> = {},
): ExtractionFact {
  return makeFact({
    factSlug: "developer-name",
    factType: "developer",
    sourceId: BROCHURE_ID,
    fieldPath: "developer.name",
    rawValue: "Coralina Development Co.",
    structuredValue: "Coralina Development Co.",
    excerpt: "Developed by Coralina Development Co.",
    locator: { kind: "page", page: 2 },
    ...overrides,
  });
}

/** The RC4.7 report describing the given facts against the default sources. */
export function makeReport(facts?: ExtractionFact[]): CrossValidationReport {
  return describeCrossSourceValidation(
    { sources: makeSources(), now: NOW },
    { projectSlug: "coralina", facts: facts ?? [makeFact(), makeAgreeingFact()] },
  ).data[0];
}

/** The RC4.6 canonical record with the base price settled from the default fact. */
export function makeRecord(): ProjectRecord {
  const fact = makeFact();
  const revision1 = describeProjectRevision({
    projectSlug: "coralina",
    number: 1,
    createdAt: NOW,
  });
  const revision2 = describeProjectRevision({
    projectSlug: "coralina",
    number: 2,
    basedOn: revision1.id,
    createdAt: NOW,
  });
  return describeProjectRecord({
    projectSlug: "coralina",
    name: "Coralina",
    version: projectRecordVersion(1, 0, 0),
    fields: [
      describeProjectField({
        projectSlug: "coralina",
        path: "pricing.basePrice",
        name: "Base price",
        values: [projectFieldValueFromFact(fact, { revisionId: revision1.id, recordedAt: NOW })],
      }),
    ],
    revisions: [revision1, revision2],
    sourceIds: [PRICE_LIST_ID],
  });
}

/** The RC4.6 described merge of the conflicting brochure reading. */
export function makeMerge(): ProjectMerge {
  return describeProjectMerge(
    { record: makeRecord(), now: NOW },
    { facts: [makeConflictingFact()] },
  ).data[0];
}

/** The default grounded developer entity declaration. */
export function makeEntity(
  overrides: Partial<KnowledgeEntityDeclaration> = {},
): KnowledgeEntityDeclaration {
  return {
    kind: "developer",
    slug: "coralina-development",
    name: "Coralina Development Co.",
    refs: [{ factId: makeDeveloperFact().id, sourceId: BROCHURE_ID }],
    ...overrides,
  };
}

/** The default grounded developed-by relation declaration. */
export function makeRelation(
  overrides: Partial<KnowledgeRelationDeclaration> = {},
): KnowledgeRelationDeclaration {
  return {
    kind: "developed_by",
    from: { kind: "project", key: "coralina" },
    to: { kind: "developer", key: "coralina-development" },
    refs: [{ factId: makeDeveloperFact().id }],
    ...overrides,
  };
}

/** The default context: sources, record, report, and a caller clock. */
export function makeContext(overrides: Partial<KnowledgeGraphContext> = {}): KnowledgeGraphContext {
  return {
    sources: makeSources(),
    report: makeReport(),
    now: NOW,
    ...overrides,
  };
}

/** The default request: the corroborated base price from both sources. */
export function makeRequest(overrides: Partial<KnowledgeGraphRequest> = {}): KnowledgeGraphRequest {
  return {
    projectSlug: "coralina",
    facts: [makeFact(), makeAgreeingFact()],
    ...overrides,
  };
}

/** The described graph of the default request in the default context. */
export function runGraph(
  context: Partial<KnowledgeGraphContext> = {},
  request: Partial<KnowledgeGraphRequest> = {},
): KnowledgeGraphResult<KnowledgeGraph> {
  return describeKnowledgeGraph(makeContext(context), makeRequest(request));
}

/** The default described graph. */
export function makeGraph(): KnowledgeGraph {
  return runGraph().data[0];
}

/** The described graph of a contested batch, with the matching report. */
export function makeContestedGraph(): KnowledgeGraph {
  const facts = [makeFact(), makeConflictingFact()];
  return runGraph({ report: makeReport(facts) }, { facts }).data[0];
}
