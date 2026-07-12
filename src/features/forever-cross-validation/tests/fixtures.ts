/**
 * Forever Cross-Source Validation — shared test fixtures.
 *
 * Deterministic builders for RC4.4 registered sources, RC4.5 extracted facts,
 * contexts, requests, and described reports. Every builder takes a partial
 * override so tests state only what they exercise, and the defaults describe
 * the Coralina price examined across the same catalogued price list the
 * RC4.4/RC4.5/RC4.6 fixtures speak about plus an independent brochure — so
 * the fixtures double as documentation of the RC4.4 → RC4.5 → RC4.7 → RC4.6
 * chain.
 */

import {
  describeExtractionFact,
  extractionMethod,
  type DescribeExtractionFactInput,
  type ExtractionFact,
} from "@/features/forever-extraction-pipeline";
import {
  describeProjectSource,
  projectSourceAuthority,
  projectSourceRelationships,
  projectSourceVersion,
  type DescribeProjectSourceInput,
  type ProjectSourceDefinition,
} from "@/features/forever-project-sources";

import type { CrossValidationContext } from "../context";
import type { CrossValidationFinding } from "../finding";
import type { CrossValidationReport, CrossValidationRequest } from "../report";
import { describeCrossSourceValidation } from "../report";
import type { CrossValidationResult } from "../result";

/** The RC4.4 catalogued price list the default facts trace to. */
export const PRICE_LIST_ID = "psrc_coralina-price-list-v1-0-0";

/** The newer received revision of the price list, chained by supersession. */
export const PRICE_LIST_V2_ID = "psrc_coralina-price-list-v2-0-0";

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

/** The newer registered price list revision, superseding revision 1.0.0. */
export function makePriceListV2Source(
  overrides: Partial<DescribeProjectSourceInput> = {},
): ProjectSourceDefinition {
  return describeProjectSource({
    projectSlug: "coralina",
    sourceSlug: "price-list",
    documentType: "price_list",
    fileFormat: "pdf",
    version: projectSourceVersion(2, 0, 0),
    authority: projectSourceAuthority("developer_official"),
    status: "verified",
    origin: "developer_website",
    relationships: projectSourceRelationships({ supersedes: PRICE_LIST_ID }),
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

/** The default context: both registered sources and a caller-supplied clock. */
export function makeContext(
  overrides: Partial<CrossValidationContext> = {},
): CrossValidationContext {
  return { sources: makeSources(), now: "2026-07-12T00:00:00.000Z", ...overrides };
}

/** The default request: the corroborated base price from both sources. */
export function makeRequest(
  overrides: Partial<CrossValidationRequest> = {},
): CrossValidationRequest {
  return {
    projectSlug: "coralina",
    facts: [makeFact(), makeAgreeingFact()],
    ...overrides,
  };
}

/** The described examination of the default request in the default context. */
export function runValidation(
  context: Partial<CrossValidationContext> = {},
  request: Partial<CrossValidationRequest> = {},
): CrossValidationResult<CrossValidationReport> {
  return describeCrossSourceValidation(makeContext(context), makeRequest(request));
}

/** The default described report. */
export function makeReport(): CrossValidationReport {
  return runValidation().data[0];
}

/** The findings of one kind in a result's report. */
export function findingsOfKind(
  result: CrossValidationResult<CrossValidationReport>,
  kind: CrossValidationFinding["kind"],
): CrossValidationFinding[] {
  return result.data[0].findings.filter((finding) => finding.kind === kind);
}
