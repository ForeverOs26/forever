import { describe, expect, it } from "vitest";

import type { ForeverProject } from "@/features/forever-database";

import {
  SyncConnectorRegistry,
  createSyncResult,
  defineSyncConnector,
  emptySyncStats,
  type SyncContext,
} from "..";
import { makeMetadata } from "./fixtures";

const projectConnector = defineSyncConnector<ForeverProject>({
  system: "website",
  entityKind: "project",
  direction: "push",
  plan(records, context: SyncContext) {
    return createSyncResult({
      data: [...records],
      stats: { ...emptySyncStats(), total: records.length, synced: records.length },
      metadata: makeMetadata({ job: context.job, recordCount: records.length }),
    });
  },
});

describe("SyncConnectorRegistry", () => {
  it("registers, resolves, and lists connectors by (system, entityKind, direction)", () => {
    const registry = new SyncConnectorRegistry();
    registry.register(projectConnector);
    expect(registry.has("website", "project", "push")).toBe(true);
    expect(registry.resolve("website", "project", "push")).toBe(projectConnector);
    expect(registry.resolve("website", "project", "pull")).toBeUndefined();
    expect(registry.list()).toEqual([projectConnector]);
  });

  it("rejects a second connector for the same triple", () => {
    const registry = new SyncConnectorRegistry();
    registry.register(projectConnector);
    expect(() => registry.register(projectConnector)).toThrow(/already registered/);
  });

  it("keeps distinct triples independent", () => {
    const registry = new SyncConnectorRegistry();
    const pullVariant = defineSyncConnector({ ...projectConnector, direction: "pull" as const });
    registry.register(projectConnector).register(pullVariant);
    expect(registry.resolve("website", "project", "push")).toBe(projectConnector);
    expect(registry.resolve("website", "project", "pull")).toBe(pullVariant);
    expect(registry.list()).toHaveLength(2);
  });
});
