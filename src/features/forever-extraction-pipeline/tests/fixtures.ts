/**
 * Forever Extraction Pipeline — shared test fixtures.
 *
 * Deterministic builders for definitions, contexts, requests, facts,
 * catalogue entries, and catalogues. Every builder takes a partial override
 * so tests state only what they exercise, and the defaults describe a
 * realistic extraction over the Coralina price list (the same document the
 * RC4.4 fixtures catalogue) so the fixtures double as documentation.
 */

import {
  describeProjectSource,
  projectSourceAuthority,
  projectSourceVersion,
  type DescribeProjectSourceInput,
  type ProjectSourceDefinition,
} from "@/features/forever-project-sources";

import type { ExtractionCatalog, ExtractionCatalogEntry } from "../catalog";
import type { ExtractionContext } from "../context";
import { buildForeverExtractionPipeline, type ExtractionDefinition } from "../definition";
import {
  describeExtractionFact,
  type DescribeExtractionFactInput,
  type ExtractionFact,
} from "../fact";
import { extractionMethod } from "../method";
import type { ExtractionRequest } from "../plan";

/** The RC4.4 describe input for the catalogued source the fixtures read. */
export function makeSourceInput(
  overrides: Partial<DescribeProjectSourceInput> = {},
): DescribeProjectSourceInput {
  return {
    projectSlug: "coralina",
    sourceSlug: "price-list",
    documentType: "price_list",
    fileFormat: "pdf",
    name: "Coralina Price List",
    version: projectSourceVersion(1, 0, 0),
    authority: projectSourceAuthority("developer_official"),
    origin: "developer_website",
    language: "en",
    uploadedAt: "2026-01-01T00:00:00.000Z",
    documentDate: "2025-12-15",
    ...overrides,
  };
}

/** The catalogued RC4.4 source the fixtures extract from. */
export function makeSource(
  overrides: Partial<DescribeProjectSourceInput> = {},
): ProjectSourceDefinition {
  return describeProjectSource(makeSourceInput(overrides));
}

/** The canonical pipeline, with overrides applied shallowly. */
export function makeDefinition(
  overrides: Partial<ExtractionDefinition> = {},
): ExtractionDefinition {
  return { ...buildForeverExtractionPipeline(), ...overrides };
}

/** An extraction context over the canonical pipeline. */
export function makeContext(overrides: Partial<ExtractionContext> = {}): ExtractionContext {
  return { definition: buildForeverExtractionPipeline(), ...overrides };
}

/** A complete extraction request over the catalogued price list. */
export function makeRequest(overrides: Partial<ExtractionRequest> = {}): ExtractionRequest {
  return { source: makeSource(), ...overrides };
}

/** The canonical fact input: the 1-bedroom base price read off page 3. */
export function makeFactInput(
  overrides: Partial<DescribeExtractionFactInput> = {},
): DescribeExtractionFactInput {
  return {
    projectSlug: "coralina",
    factSlug: "price-1br",
    factType: "price",
    sourceId: "psrc_coralina-price-list-v1-0-0",
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

/** A fully described fact, with overrides applied shallowly. */
export function makeFact(overrides: Partial<ExtractionFact> = {}): ExtractionFact {
  return { ...describeExtractionFact(makeFactInput()), ...overrides };
}

export function makeEntry(overrides: Partial<ExtractionCatalogEntry> = {}): ExtractionCatalogEntry {
  return {
    definition: makeDefinition(),
    enabled: true,
    registeredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeCatalog(overrides: Partial<ExtractionCatalog> = {}): ExtractionCatalog {
  return {
    id: "forever-extractions",
    name: "Forever Extractions",
    entries: [makeEntry()],
    ...overrides,
  };
}
