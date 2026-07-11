import { describe, expect, it } from "vitest";

import { foreverDatabaseEntities, type Slug } from "@/features/forever-database";
import type { ImportFormat, ImportSourceKind } from "@/features/forever-import";
import type { SyncDirection, SyncSystem } from "@/features/forever-sync";

import {
  defineSource,
  sourceTypeToImportFormat,
  sourceTypeToSyncSystem,
  validateSourceRegistry,
  type SourceDefinition,
  type SourceEntityKind,
} from "..";
import { makeDefinition, makeRegistry } from "./fixtures";

/**
 * RC3.3 is additive: it consumes the RC3.0 id/slug types, the RC3.1 entity
 * taxonomy, and the RC3.2 sync vocabulary read-only, and describes sources
 * without moving any data. These tests pin that contract so the source registry
 * can never drift away from the foundations it reuses.
 */
describe("backward compatibility with RC3.0, RC3.1, and RC3.2", () => {
  it("reuses the RC3.1 entity kinds rather than redefining a taxonomy", () => {
    // SourceEntityKind is exactly the RC3.1 ImportSourceKind — assignable both ways.
    const kind: SourceEntityKind = "project";
    const importKind: ImportSourceKind = kind;
    expect(importKind).toBe("project");
  });

  it("reuses the RC3.0 Slug type for identity", () => {
    const slug: Slug = makeDefinition().identity.slug;
    expect(slug).toBe("developer-website");
  });

  it("bridges source types to the RC3.1 and RC3.2 vocabularies without redefining them", () => {
    const format: ImportFormat | undefined = sourceTypeToImportFormat("csv");
    const system: SyncSystem | undefined = sourceTypeToSyncSystem("crm");
    expect(format).toBe("csv");
    expect(system).toBe("crm");
  });

  it("describes every future source through one definition shape", () => {
    const directions: SyncDirection[] = ["pull", "push"];
    const definitions: SourceDefinition[] = (
      [
        [
          "src_developer_website",
          "developer-website",
          "Developer Website",
          "developer_website",
          "web",
        ],
        ["src_crm", "crm", "CRM", "crm", "crm"],
        ["src_marketplace", "marketplace", "Marketplace", "marketplace", "marketplace"],
        [
          "src_forever_database",
          "forever-database",
          "Forever Database",
          "forever_database",
          "internal_database",
        ],
        ["src_manual_entry", "manual-entry", "Manual Entry", "manual_entry", "manual"],
        ["src_pdf", "pdf", "PDF", "pdf", "file"],
        ["src_excel", "excel", "Excel", "excel", "file"],
        ["src_csv", "csv", "CSV", "csv", "file"],
        ["src_json", "json", "JSON", "json", "file"],
        ["src_api", "api", "API", "api", "api"],
        ["src_ai_agent", "ai-agent", "AI Agent", "ai_agent", "ai"],
        ["src_future", "future-provider", "Future Provider", "unknown", "unknown"],
      ] as const
    ).map(([id, slug, name, type, category]) =>
      defineSource(
        makeDefinition({
          identity: { id, slug, name, type, category },
          supportedEntities: ["project"],
          syncDirections: directions,
        }),
      ),
    );

    const registry = makeRegistry({
      entries: definitions.map((definition) => ({ definition, status: "draft" as const })),
    });
    // Every future source is describable and the whole catalogue validates clean.
    expect(validateSourceRegistry(registry).valid).toBe(true);
    expect(registry.entries).toHaveLength(12);
  });

  it("reads the RC3.0 entity registry without altering it", () => {
    expect(foreverDatabaseEntities.project.tableName).toBe("forever_projects");
  });
});
