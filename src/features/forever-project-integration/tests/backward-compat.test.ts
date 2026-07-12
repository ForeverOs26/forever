import { describe, expect, it } from "vitest";

import { foreverDatabaseEntities, type Slug } from "@/features/forever-database";
import type { ImportSourceKind } from "@/features/forever-import";
import type { SyncDirection, SyncRetryPolicy, SyncSystem } from "@/features/forever-sync";
import type { SourceId } from "@/features/forever-source-registry";
import type { ConnectorId } from "@/features/forever-connectors";
import type { PipelineId } from "@/features/forever-pipeline";

import {
  defineProjectIntegration,
  projectIntegrationConnectorIds,
  projectIntegrationPipelineIds,
  projectIntegrationSourceIds,
  projectIntegrationSystems,
  validateProjectIntegrationRegistry,
  type ProjectIntegrationDefinition,
  type ProjectIntegrationEntityKind,
  type ProjectIntegrationPolicy,
} from "..";
import { makeDefinition, makeRegistry, makeStages } from "./fixtures";

/**
 * RC4.0 is the first integration layer: it consumes the RC3.0 id/slug/time
 * types, the RC3.1 entity taxonomy and severity vocabulary, the RC3.2 system,
 * direction, and retry vocabularies, the RC3.3 source ids, the RC3.4 connector
 * ids, and the RC3.5 pipeline ids read-only, and describes integrations without
 * moving any data. These tests pin that contract so the integration foundation
 * can never drift away from the foundations it reuses.
 */
describe("backward compatibility with RC3.0–RC3.5", () => {
  it("reuses the RC3.1 entity kinds rather than redefining a taxonomy", () => {
    const kind: ProjectIntegrationEntityKind = "project";
    const importKind: ImportSourceKind = kind;
    expect(importKind).toBe("project");
  });

  it("reuses the RC3.0 Slug type for identity", () => {
    const slug: Slug = makeDefinition().identity.slug;
    expect(slug).toBe("coralina");
  });

  it("reuses the RC3.2 system, direction, and retry vocabularies", () => {
    const system: SyncSystem = "forever_database";
    const direction: SyncDirection = "push";
    const retry: SyncRetryPolicy = makeDefinition().policy!.retry;
    expect(system).toBe("forever_database");
    expect(direction).toBe("push");
    expect(retry).toEqual({ maxAttempts: 1, backoff: "none" });
    // An integration policy's retry IS the RC3.2 retry shape.
    const policy: ProjectIntegrationPolicy = makeDefinition().policy!;
    const asSyncRetry: SyncRetryPolicy = policy.retry;
    expect(asSyncRetry.maxAttempts).toBe(1);
  });

  it("references RC3.3 sources, RC3.4 connectors, and RC3.5 pipelines without redefining id schemes", () => {
    const sourceIds: SourceId[] = projectIntegrationSourceIds(makeDefinition());
    const connectorIds: ConnectorId[] = projectIntegrationConnectorIds(makeDefinition());
    const pipelineIds: PipelineId[] = projectIntegrationPipelineIds(makeDefinition());
    const systems: SyncSystem[] = projectIntegrationSystems(makeDefinition());
    expect(sourceIds).toEqual(["src_developer_website"]);
    expect(connectorIds).toEqual(["conn_developer_website"]);
    expect(pipelineIds).toEqual(["pipe_coralina_import"]);
    expect(systems).toEqual(["forever_database"]);
  });

  it("describes every future integration through one definition shape", () => {
    const definitions: ProjectIntegrationDefinition[] = (
      [
        ["integ_website_project", "website-project", "Website Project", "project"],
        ["integ_developer_set", "developer-set", "Developer Set", "developer"],
        ["integ_phuket_portfolio", "phuket-portfolio", "Phuket Portfolio", "portfolio"],
        ["integ_full_refresh", "full-refresh", "Full Refresh", "composite"],
      ] as const
    ).map(([id, slug, name, scope]) =>
      defineProjectIntegration(
        makeDefinition({
          identity: { id, slug, name, scope },
          stages: makeStages(),
          entities: ["project"],
        }),
      ),
    );

    const registry = makeRegistry({
      entries: definitions.map((definition) => ({ definition, enabled: false })),
    });
    expect(validateProjectIntegrationRegistry(registry).valid).toBe(true);
    expect(registry.entries).toHaveLength(4);
  });

  it("reads the RC3.0 entity registry without altering it", () => {
    expect(foreverDatabaseEntities.project.tableName).toBe("forever_projects");
  });
});
