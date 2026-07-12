/**
 * Forever Project Factory — shared test fixtures.
 *
 * Deterministic builders for factories, contexts, build requests, catalogue
 * entries, and catalogues. Every builder takes a partial override so tests
 * state only what they exercise, and the defaults describe the canonical
 * factory so the fixtures double as documentation.
 */

import { buildForeverProjectFactory, type FactoryDefinition } from "../definition";
import type { FactoryBuildRequest } from "../build";
import type { FactoryCatalog, FactoryCatalogEntry } from "../catalog";
import type { FactoryContext } from "../context";

/** The canonical factory, with overrides applied shallowly. */
export function makeFactory(overrides: Partial<FactoryDefinition> = {}): FactoryDefinition {
  return { ...buildForeverProjectFactory(), ...overrides };
}

/** A build context over the canonical factory. */
export function makeContext(overrides: Partial<FactoryContext> = {}): FactoryContext {
  return { definition: buildForeverProjectFactory(), ...overrides };
}

/** A complete build request for a realistic verified project. */
export function makeRequest(overrides: Partial<FactoryBuildRequest> = {}): FactoryBuildRequest {
  return { slug: "coralina", name: "Coralina", ...overrides };
}

export function makeEntry(overrides: Partial<FactoryCatalogEntry> = {}): FactoryCatalogEntry {
  return {
    definition: makeFactory(),
    enabled: false,
    registeredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeCatalog(overrides: Partial<FactoryCatalog> = {}): FactoryCatalog {
  return {
    id: "forever-factories",
    name: "Forever Factories",
    entries: [makeEntry()],
    ...overrides,
  };
}
