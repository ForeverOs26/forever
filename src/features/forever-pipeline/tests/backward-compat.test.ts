import { describe, expect, it } from "vitest";

import { foreverDatabaseEntities, type Slug } from "@/features/forever-database";
import type { ImportSourceKind } from "@/features/forever-import";
import type { SyncDirection, SyncRetryPolicy } from "@/features/forever-sync";
import type { SourceId } from "@/features/forever-source-registry";
import type { ConnectorId } from "@/features/forever-connectors";

import {
  definePipeline,
  pipelineConnectorIds,
  pipelineSourceIds,
  validatePipelineRegistry,
  type PipelineDefinition,
  type PipelineEntityKind,
  type PipelinePolicy,
} from "..";
import { makeDefinition, makeRegistry, makeStages } from "./fixtures";

/**
 * RC3.5 is additive: it consumes the RC3.0 id/slug/time types, the RC3.1 entity
 * taxonomy and severity vocabulary, the RC3.2 direction and retry vocabularies,
 * the RC3.3 source ids, and the RC3.4 connector ids read-only, and describes
 * pipelines without moving any data. These tests pin that contract so the
 * pipeline foundation can never drift away from the foundations it reuses.
 */
describe("backward compatibility with RC3.0–RC3.4", () => {
  it("reuses the RC3.1 entity kinds rather than redefining a taxonomy", () => {
    const kind: PipelineEntityKind = "project";
    const importKind: ImportSourceKind = kind;
    expect(importKind).toBe("project");
  });

  it("reuses the RC3.0 Slug type for identity", () => {
    const slug: Slug = makeDefinition().identity.slug;
    expect(slug).toBe("coralina-import");
  });

  it("reuses the RC3.2 direction and retry vocabularies", () => {
    const direction: SyncDirection = "push";
    const retry: SyncRetryPolicy = makeDefinition().policy!.retry;
    expect(direction).toBe("push");
    expect(retry).toEqual({ maxAttempts: 1, backoff: "none" });
    // A pipeline policy's retry IS the RC3.2 retry shape.
    const policy: PipelinePolicy = makeDefinition().policy!;
    const asSyncRetry: SyncRetryPolicy = policy.retry;
    expect(asSyncRetry.maxAttempts).toBe(1);
  });

  it("references RC3.3 source ids and RC3.4 connector ids without redefining id schemes", () => {
    const sourceIds: SourceId[] = pipelineSourceIds(makeDefinition());
    const connectorIds: ConnectorId[] = pipelineConnectorIds(makeDefinition());
    expect(sourceIds).toEqual(["src_developer_website"]);
    expect(connectorIds).toEqual(["conn_developer_website"]);
  });

  it("describes every future pipeline through one definition shape", () => {
    const definitions: PipelineDefinition[] = (
      [
        ["pipe_website_import", "website-import", "Website Import", "import"],
        ["pipe_crm_sync", "crm-sync", "CRM Sync", "sync"],
        ["pipe_marketplace_export", "marketplace-export", "Marketplace Export", "export"],
        ["pipe_full_refresh", "full-refresh", "Full Refresh", "composite"],
      ] as const
    ).map(([id, slug, name, mode]) =>
      definePipeline(
        makeDefinition({
          identity: { id, slug, name, mode },
          stages: makeStages(),
          entities: ["project"],
        }),
      ),
    );

    const registry = makeRegistry({
      entries: definitions.map((definition) => ({ definition, enabled: false })),
    });
    expect(validatePipelineRegistry(registry).valid).toBe(true);
    expect(registry.entries).toHaveLength(4);
  });

  it("reads the RC3.0 entity registry without altering it", () => {
    expect(foreverDatabaseEntities.project.tableName).toBe("forever_projects");
  });
});
