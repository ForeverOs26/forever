/**
 * Forever Project Template — shared test fixtures.
 *
 * Deterministic builders for packages, catalogue entries, and catalogues. Every
 * builder takes a partial override so tests state only what they exercise, and the
 * defaults describe a realistic complete package (a project that provides every
 * canonical component) so the fixtures double as documentation.
 */

import { buildProjectPackage, type ProjectPackage } from "../package";
import type { ProjectCatalog, ProjectCatalogEntry } from "../catalog";
import { PROJECT_COMPONENT_KINDS } from "../component";

/** A complete package: provides every component and covers the core entities. */
export function makePackage(overrides: Partial<Parameters<typeof buildProjectPackage>[1]> = {}): ProjectPackage {
  return buildProjectPackage("coralina", {
    name: "Coralina",
    provides: [...PROJECT_COMPONENT_KINDS],
    entities: ["project", "document", "media"],
    ...overrides,
  });
}

export function makeEntry(overrides: Partial<ProjectCatalogEntry> = {}): ProjectCatalogEntry {
  return {
    package: makePackage(),
    enabled: false,
    registeredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeCatalog(overrides: Partial<ProjectCatalog> = {}): ProjectCatalog {
  return {
    id: "forever-packages",
    name: "Forever Packages",
    entries: [makeEntry()],
    ...overrides,
  };
}
