import { describe, expect, it } from "vitest";

import { foreverDatabaseEntities, type Slug } from "@/features/forever-database";
import type { ImportSourceKind } from "@/features/forever-import";
import type { SyncDirection, SyncProtocol, SyncSystem } from "@/features/forever-sync";
import type { SourceId } from "@/features/forever-source-registry";

import {
  connectorSyncSystem,
  defineConnector,
  validateConnectorRegistry,
  type ConnectorDefinition,
  type ConnectorEntityKind,
} from "..";
import { makeDefinition, makeRegistry } from "./fixtures";

/**
 * RC3.4 is additive: it consumes the RC3.0 id/slug types, the RC3.1 entity
 * taxonomy, the RC3.2 protocol/system/direction vocabulary, and the RC3.3 source
 * ids read-only, and describes connectors without moving any data. These tests
 * pin that contract so the connector foundation can never drift away from the
 * foundations it reuses.
 */
describe("backward compatibility with RC3.0–RC3.3", () => {
  it("reuses the RC3.1 entity kinds rather than redefining a taxonomy", () => {
    const kind: ConnectorEntityKind = "project";
    const importKind: ImportSourceKind = kind;
    expect(importKind).toBe("project");
  });

  it("reuses the RC3.0 Slug type for identity", () => {
    const slug: Slug = makeDefinition().identity.slug;
    expect(slug).toBe("developer-website");
  });

  it("reuses the RC3.2 protocol/system/direction vocabularies", () => {
    const protocol: SyncProtocol = makeDefinition().identity.protocol;
    const system: SyncSystem = connectorSyncSystem(makeDefinition());
    const directions: SyncDirection[] = makeDefinition().directions;
    expect(protocol).toBe("http");
    expect(system).toBe("website");
    expect(directions).toEqual(["pull"]);
  });

  it("binds to an RC3.3 source id without redefining an id scheme", () => {
    const sourceId: SourceId | undefined = makeDefinition().sourceId;
    expect(sourceId).toBe("src_developer_website");
  });

  it("describes every future connector through one definition shape", () => {
    const definitions: ConnectorDefinition[] = (
      [
        ["conn_developer_website", "developer-website", "Developer Website", "http", "website"],
        ["conn_crm", "crm", "CRM", "http", "crm"],
        ["conn_marketplace", "marketplace", "Marketplace", "http", "marketplace"],
        ["conn_forever_database", "forever-database", "Forever Database", "memory", "forever_database"],
        ["conn_manual", "manual", "Manual", "manual", "manual"],
        ["conn_pdf", "pdf", "PDF", "file", "forever_database"],
        ["conn_api", "api", "API", "http", "api"],
        ["conn_graphql", "graphql", "GraphQL", "graphql", "api"],
        ["conn_webhook", "webhook", "Webhook", "webhook", "crm"],
        ["conn_ai_agent", "ai-agent", "AI Agent", "http", "ai_agents"],
      ] as const
    ).map(([id, slug, name, protocol, targetSystem]) =>
      defineConnector(
        makeDefinition({
          identity: { id, slug, name, protocol, targetSystem },
          supportedEntities: ["project"],
          directions: ["pull"],
        }),
      ),
    );

    const registry = makeRegistry({
      entries: definitions.map((definition) => ({
        definition,
        status: "unconfigured" as const,
      })),
    });
    expect(validateConnectorRegistry(registry).valid).toBe(true);
    expect(registry.entries).toHaveLength(10);
  });

  it("reads the RC3.0 entity registry without altering it", () => {
    expect(foreverDatabaseEntities.project.tableName).toBe("forever_projects");
  });
});
