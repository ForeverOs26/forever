/**
 * Forever Canonical Project Database — shared test fixtures.
 *
 * Deterministic builders for facts, values, fields, revisions, snapshots,
 * records, contexts, requests, catalogue entries, catalogues, and databases.
 * Every builder takes a partial override so tests state only what they
 * exercise, and the defaults describe the canonical Coralina record settled
 * from the same price-list fact the RC4.5 fixtures extract — so the fixtures
 * double as documentation of the RC4.4 → RC4.5 → RC4.6 chain.
 */

import {
  describeExtractionFact,
  extractionMethod,
  type DescribeExtractionFactInput,
  type ExtractionFact,
} from "@/features/forever-extraction-pipeline";
import { projectSourceVersion } from "@/features/forever-project-sources";

import type { ProjectCatalog, ProjectCatalogEntry } from "../catalog";
import { projectChange } from "../change";
import type { ProjectContext } from "../context";
import { emptyProjectDatabase, type ProjectDatabase } from "../database";
import { describeProjectField, type ProjectField } from "../field";
import type { ProjectHistoryEntry } from "../history";
import type { ProjectMerge, ProjectRequest } from "../merge";
import { describeProjectMerge } from "../merge";
import { describeProjectRecord, type ProjectRecord } from "../record";
import { describeProjectRevision, type ProjectRevision } from "../revision";
import { describeProjectSnapshot, type ProjectSnapshot } from "../snapshot";
import type { ProjectFieldValue } from "../value";
import { projectFieldValueFromFact } from "../value";
import { projectRecordVersion } from "../version";

/** The RC4.4 source id the canonical fixtures trace to. */
export const SOURCE_ID = "psrc_coralina-price-list-v1-0-0";

/** A second, independent RC4.4 source for cross-source conflict scenarios. */
export const OTHER_SOURCE_ID = "psrc_coralina-brochure-v1-0-0";

/** The RC4.5 describe input for the fact the canonical value settles from. */
export function makeFactInput(
  overrides: Partial<DescribeExtractionFactInput> = {},
): DescribeExtractionFactInput {
  return {
    projectSlug: "coralina",
    factSlug: "price-1br",
    factType: "price",
    sourceId: SOURCE_ID,
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

/** The canonical value the fixture fact settles into, with overrides. */
export function makeValue(overrides: Partial<ProjectFieldValue> = {}): ProjectFieldValue {
  return { ...projectFieldValueFromFact(makeFact()), ...overrides };
}

/** The canonical base-price field holding the settled value. */
export function makeField(overrides: Partial<ProjectField> = {}): ProjectField {
  return {
    ...describeProjectField({
      projectSlug: "coralina",
      path: "pricing.basePrice",
      name: "Base price",
      values: [makeValue()],
      validationStatus: "valid",
    }),
    ...overrides,
  };
}

/** The first revision of the canonical record: the base price was added. */
export function makeRevision(overrides: Partial<ProjectRevision> = {}): ProjectRevision {
  const field = makeField();
  return {
    ...describeProjectRevision({
      projectSlug: "coralina",
      number: 1,
      createdAt: "2026-03-01T00:00:00.000Z",
      reason: "Initial settlement from the catalogued price list",
      changes: [
        projectChange("added", field.path, {
          fieldId: field.id,
          after: makeValue(),
          factId: makeFact().id,
        }),
      ],
    }),
    ...overrides,
  };
}

/** The canonical Coralina record, with overrides applied shallowly. */
export function makeRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    ...describeProjectRecord({
      projectSlug: "coralina",
      name: "Coralina",
      version: projectRecordVersion(1, 0, 0),
      status: "active",
      fields: [makeField()],
      revisions: [makeRevision()],
      sourceIds: [SOURCE_ID],
    }),
    ...overrides,
  };
}

/** A snapshot of the canonical record at its first revision. */
export function makeSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    ...describeProjectSnapshot(makeRecord(), makeRevision(), {
      takenAt: "2026-03-01T00:00:00.000Z",
    }),
    ...overrides,
  };
}

/** A merge context over the canonical record. */
export function makeContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return { record: makeRecord(), now: "2026-07-12T00:00:00.000Z", ...overrides };
}

/** A merge request carrying one incoming fact for a brand-new field. */
export function makeRequest(overrides: Partial<ProjectRequest> = {}): ProjectRequest {
  return {
    facts: [
      makeFact({ factSlug: "area-1br", factType: "internal_area", fieldPath: "units.area1br" }),
    ],
    reason: "Settle the latest extraction batch",
    ...overrides,
  };
}

/** The described merge of the default request into the canonical record. */
export function makeMerge(): ProjectMerge {
  return describeProjectMerge(makeContext(), makeRequest()).data[0];
}

/** A settled history entry for the canonical project. */
export function makeHistoryEntry(
  overrides: Partial<ProjectHistoryEntry> = {},
): ProjectHistoryEntry {
  return {
    projectId: "proj_coralina",
    mergeId: "pmrg_coralina-r2",
    revisionId: "prev_coralina-r2",
    state: "succeeded",
    outcome: "success",
    startedAt: "2026-07-12T00:00:00.000Z",
    finishedAt: "2026-07-12T00:00:01.000Z",
    stats: { stages: 1, steps: 1, completed: 1, skipped: 0, failed: 0, warnings: 0, errors: 0 },
    ...overrides,
  };
}

/** A catalogue entry over the canonical record. */
export function makeEntry(overrides: Partial<ProjectCatalogEntry> = {}): ProjectCatalogEntry {
  return {
    record: makeRecord(),
    enabled: true,
    registeredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A catalogue holding the canonical record. */
export function makeCatalog(overrides: Partial<ProjectCatalog> = {}): ProjectCatalog {
  return {
    id: "forever-projects",
    name: "Forever Projects",
    entries: [makeEntry()],
    ...overrides,
  };
}

/** A database holding the canonical record. */
export function makeDatabase(overrides: Partial<ProjectDatabase> = {}): ProjectDatabase {
  return {
    ...emptyProjectDatabase("pdb_forever", "Forever Canonical Projects"),
    records: [makeRecord()],
    ...overrides,
  };
}
