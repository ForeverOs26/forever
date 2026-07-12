/**
 * Forever Project Sources — shared test fixtures.
 *
 * Deterministic builders for sources, catalogue entries, and catalogues. Every
 * builder takes a partial override so tests state only what they exercise, and
 * the defaults describe a realistic Coralina price list so the fixtures double
 * as documentation.
 */

import type { DescribeProjectSourceInput, ProjectSourceDefinition } from "../definition";
import { describeProjectSource } from "../definition";
import type { ProjectSourceCatalog, ProjectSourceCatalogEntry } from "../catalog";
import { projectSourceAuthority } from "../authority";
import { projectSourceVersion } from "../version";

/** The canonical describe input: a verified Coralina developer price list. */
export function makeInput(
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

/** A fully described source, with overrides applied shallowly. */
export function makeSource(
  overrides: Partial<ProjectSourceDefinition> = {},
): ProjectSourceDefinition {
  return { ...describeProjectSource(makeInput()), ...overrides };
}

export function makeEntry(
  overrides: Partial<ProjectSourceCatalogEntry> = {},
): ProjectSourceCatalogEntry {
  return {
    definition: makeSource(),
    enabled: true,
    registeredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeCatalog(overrides: Partial<ProjectSourceCatalog> = {}): ProjectSourceCatalog {
  return {
    id: "forever-sources",
    name: "Forever Sources",
    entries: [makeEntry()],
    ...overrides,
  };
}
