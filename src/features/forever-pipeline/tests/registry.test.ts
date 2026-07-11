import { describe, expect, it } from "vitest";

import {
  PipelineDefinitionRegistry,
  addPipelineEntry,
  createPipelineResult,
  emptyPipelineRegistry,
  emptyPipelineStats,
  findPipelineEntry,
  listEnabledPipelineEntries,
  appendPipelineHistory,
  emptyPipelineHistory,
  latestPipelineHistoryEntry,
} from "..";
import { makeDefinition, makeEntry, makeRegistry } from "./fixtures";

describe("PipelineDefinitionRegistry", () => {
  it("registers, resolves, and lists definitions in insertion order", () => {
    const importPipe = makeDefinition();
    const syncPipe = makeDefinition({
      identity: { id: "pipe_crm_sync", slug: "crm-sync", name: "CRM Sync", mode: "sync" },
      entities: ["developer"],
    });
    const registry = new PipelineDefinitionRegistry().register(importPipe).register(syncPipe);

    expect(registry.has("pipe_coralina_import")).toBe(true);
    expect(registry.resolve("pipe_crm_sync")).toBe(syncPipe);
    expect(registry.list()).toEqual([importPipe, syncPipe]);
    expect(registry.listByMode("sync")).toEqual([syncPipe]);
    expect(registry.listByEntity("project")).toEqual([importPipe]);
    expect(registry.listByEntity("developer")).toEqual([syncPipe]);
  });

  it("throws when the same id is registered twice", () => {
    const registry = new PipelineDefinitionRegistry().register(makeDefinition());
    expect(() => registry.register(makeDefinition())).toThrow(/already registered/);
  });

  it("resolves an unknown id to undefined", () => {
    expect(new PipelineDefinitionRegistry().resolve("pipe_missing")).toBeUndefined();
  });
});

describe("registry data model", () => {
  it("builds an empty registry and appends immutably", () => {
    const empty = emptyPipelineRegistry("cat", "Catalogue");
    expect(empty).toEqual({ id: "cat", name: "Catalogue", entries: [] });

    const appended = addPipelineEntry(empty, makeEntry());
    expect(empty.entries).toHaveLength(0);
    expect(appended.entries).toHaveLength(1);
  });

  it("finds entries by pipeline id and filters enabled entries", () => {
    const registry = makeRegistry({
      entries: [makeEntry(), makeEntry({ enabled: true })],
    });
    expect(findPipelineEntry(registry, "pipe_coralina_import")).toBe(registry.entries[0]);
    expect(listEnabledPipelineEntries(registry)).toHaveLength(1);
  });
});

describe("result and history builders", () => {
  it("derives ok/state/outcome from reconciled stats", () => {
    const result = createPipelineResult<{ id: string }>({
      data: [{ id: "p1" }],
      issues: [{ code: "x", message: "warn", severity: "warning" }],
      stats: { ...emptyPipelineStats(), stages: 4, steps: 5, completed: 5 },
      metadata: { pipelineId: "pipe_coralina_import", stageCount: 4, stepCount: 5, entityCount: 2 },
    });
    expect(result.ok).toBe(true);
    expect(result.state).toBe("succeeded");
    expect(result.outcome).toBe("success");
    expect(result.stats.warnings).toBe(1);
    expect(result.stats.errors).toBe(0);
  });

  it("marks a result not ok when a blocking error is present", () => {
    const result = createPipelineResult<never>({
      data: [],
      issues: [{ code: "e", message: "bad", severity: "error" }],
      stats: emptyPipelineStats(),
      metadata: { pipelineId: "pipe_x", stageCount: 0, stepCount: 0, entityCount: 0 },
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe("failed");
    expect(result.stats.errors).toBe(1);
  });

  it("appends history immutably and reads the latest entry", () => {
    const history = emptyPipelineHistory("pipe_coralina_import");
    const entry = {
      pipelineId: "pipe_coralina_import",
      state: "succeeded" as const,
      outcome: "success" as const,
      stats: emptyPipelineStats(),
    };
    const appended = appendPipelineHistory(history, entry);
    expect(history.entries).toHaveLength(0);
    expect(appended.entries).toHaveLength(1);
    expect(latestPipelineHistoryEntry(appended)).toBe(entry);
    expect(latestPipelineHistoryEntry(history)).toBeUndefined();
  });
});
