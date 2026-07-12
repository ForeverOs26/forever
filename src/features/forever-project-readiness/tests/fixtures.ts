/**
 * Forever Project Readiness — shared test fixtures.
 *
 * Deterministic builders for RC4.4 registered sources, RC4.5 extracted
 * facts, an RC4.6 canonical record, an RC4.7 cross-source validation report,
 * readiness requirements and profiles, contexts, requests, and described
 * readiness reports. Every builder takes a partial override so tests state
 * only what they exercise, and the defaults describe the Coralina base price
 * examined across the same catalogued price list the
 * RC4.4/RC4.5/RC4.6/RC4.7/RC4.8 fixtures speak about plus an independent
 * brochure — so the fixtures double as documentation of the
 * RC4.4 → RC4.5 → RC4.6 → RC4.7 → RC4.9 chain.
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
  describeProjectRecord,
  describeProjectRevision,
  projectFieldValueFromFact,
  projectRecordVersion,
  type ProjectFieldValue,
  type ProjectRecord,
} from "@/features/forever-project-database";
import {
  describeProjectSource,
  projectSourceAuthority,
  projectSourceVersion,
  type DescribeProjectSourceInput,
  type ProjectSourceDefinition,
} from "@/features/forever-project-sources";

import type { ReadinessContext } from "../context";
import type { DescribeReadinessProfileInput, ReadinessProfile } from "../profile";
import { describeReadinessProfile } from "../profile";
import type { ReadinessReport, ReadinessRequest } from "../report";
import { describeProjectReadiness } from "../report";
import type { ReadinessRequirement } from "../requirement";
import type { ReadinessResult } from "../result";

/** The deterministic caller clock every default context supplies. */
export const NOW = "2026-07-12T00:00:00.000Z";

/** The canonical path every default field requirement addresses. */
export const PRICE_PATH = "pricing.basePrice";

/** The RC4.4 catalogued price list the default facts trace to. */
export const PRICE_LIST_ID = "psrc_coralina-price-list-v1-0-0";

/** An independent RC4.4 catalogued brochure. */
export const BROCHURE_ID = "psrc_coralina-brochure-v1-0-0";

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
    fieldPath: PRICE_PATH,
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
  const revision = describeProjectRevision({
    projectSlug: "coralina",
    number: 1,
    createdAt: NOW,
  });
  return describeProjectRecord({
    projectSlug: "coralina",
    name: "Coralina",
    version: projectRecordVersion(1, 0, 0),
    fields: [
      describeProjectField({
        projectSlug: "coralina",
        path: PRICE_PATH,
        name: "Base price",
        values: [projectFieldValueFromFact(fact, { revisionId: revision.id, recordedAt: NOW })],
      }),
    ],
    revisions: [revision],
    sourceIds: [PRICE_LIST_ID],
  });
}

/** The RC4.6 record with the given value history at the default price path. */
export function makeRecordWithValues(values: ProjectFieldValue[]): ProjectRecord {
  return describeProjectRecord({
    projectSlug: "coralina",
    name: "Coralina",
    version: projectRecordVersion(1, 0, 0),
    fields: [
      describeProjectField({
        projectSlug: "coralina",
        path: PRICE_PATH,
        name: "Base price",
        values,
      }),
    ],
  });
}

/** The default stated requirements — the hand-kept readiness audit, stated. */
export function makeRequirements(): ReadinessRequirement[] {
  return [
    { kind: "field_present", path: PRICE_PATH },
    { kind: "field_confidence", path: PRICE_PATH, minimumConfidence: "medium" },
    { kind: "field_corroborated", path: PRICE_PATH },
    { kind: "field_uncontested", path: PRICE_PATH },
    { kind: "source_present", documentType: "price_list", minimumTrust: "standard" },
    { kind: "findings_clear", path: PRICE_PATH, necessity: "recommended" },
  ];
}

/** The default reusable profile carrying the default requirements. */
export function makeProfile(
  overrides: Partial<DescribeReadinessProfileInput> = {},
): ReadinessProfile {
  return describeReadinessProfile({
    slug: "minimum-intake",
    name: "Minimum viable intake",
    requirements: makeRequirements(),
    ...overrides,
  });
}

/** The default context: sources, record, report, and a caller clock. */
export function makeContext(overrides: Partial<ReadinessContext> = {}): ReadinessContext {
  return {
    sources: makeSources(),
    record: makeRecord(),
    report: makeReport(),
    now: NOW,
    ...overrides,
  };
}

/** The default request: the default requirements stated inline. */
export function makeRequest(overrides: Partial<ReadinessRequest> = {}): ReadinessRequest {
  return {
    projectSlug: "coralina",
    requirements: makeRequirements(),
    ...overrides,
  };
}

/** The described examination of the default request in the default context. */
export function runReadiness(
  context: Partial<ReadinessContext> = {},
  request: Partial<ReadinessRequest> = {},
): ReadinessResult<ReadinessReport> {
  return describeProjectReadiness(makeContext(context), makeRequest(request));
}

/** The default described report — everything met, standing `ready`. */
export function makeReadinessReport(): ReadinessReport {
  return runReadiness().data[0];
}

/** The described report of a contested batch, with the matching RC4.7 report. */
export function makeContestedReadinessReport(): ReadinessReport {
  const facts = [makeFact(), makeConflictingFact()];
  return runReadiness({ report: makeReport(facts) }).data[0];
}
