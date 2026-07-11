/**
 * Forever Source Registry — shared test fixtures.
 *
 * Deterministic builders for identities, versions, capabilities, definitions,
 * entries, and registries. Every builder takes a partial override so tests state
 * only what they exercise, and the defaults describe a realistic future source
 * (the Developer Website) so the fixtures double as documentation.
 */

import { sourceCapability, type SourceCapability } from "../capability";
import type { SourceDefinition } from "../definition";
import type { SourceRegistry, SourceRegistryEntry } from "../entry";
import type { SourceIdentity } from "../identity";
import { sourceVersion } from "../version";

export function makeIdentity(overrides: Partial<SourceIdentity> = {}): SourceIdentity {
  return {
    id: "src_developer_website",
    slug: "developer-website",
    name: "Developer Website",
    type: "developer_website",
    category: "web",
    ...overrides,
  };
}

export function makeCapabilities(): SourceCapability[] {
  return [sourceCapability("read"), sourceCapability("list"), sourceCapability("media")];
}

export function makeDefinition(overrides: Partial<SourceDefinition> = {}): SourceDefinition {
  return {
    identity: makeIdentity(),
    version: sourceVersion(0, 1, 0),
    lifecycle: "planned",
    priority: "secondary",
    trustLevel: "standard",
    capabilities: makeCapabilities(),
    supportedEntities: ["project", "media"],
    syncSystem: "website",
    syncDirections: ["pull"],
    ...overrides,
  };
}

export function makeEntry(overrides: Partial<SourceRegistryEntry> = {}): SourceRegistryEntry {
  return {
    definition: makeDefinition(),
    status: "draft",
    registeredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeRegistry(overrides: Partial<SourceRegistry> = {}): SourceRegistry {
  return {
    id: "forever-source-registry",
    name: "Forever Source Registry",
    entries: [makeEntry()],
    ...overrides,
  };
}
