import { describe, expect, it } from "vitest";

import {
  ProjectIntegrationDefinitionRegistry,
  addProjectIntegrationEntry,
  appendProjectIntegrationHistory,
  createProjectIntegrationResult,
  emptyProjectIntegrationHistory,
  emptyProjectIntegrationRegistry,
  emptyProjectIntegrationStats,
  findProjectIntegrationEntry,
  latestProjectIntegrationHistoryEntry,
  listEnabledProjectIntegrationEntries,
} from "..";
import { makeDefinition, makeEntry, makeRegistry } from "./fixtures";

describe("ProjectIntegrationDefinitionRegistry", () => {
  it("registers, resolves, and lists definitions in insertion order", () => {
    const projectIntegration = makeDefinition();
    const developerIntegration = makeDefinition({
      identity: {
        id: "integ_developer",
        slug: "developer-x",
        name: "Developer X",
        scope: "developer",
      },
      entities: ["developer"],
    });
    const registry = new ProjectIntegrationDefinitionRegistry()
      .register(projectIntegration)
      .register(developerIntegration);

    expect(registry.has("integ_coralina")).toBe(true);
    expect(registry.resolve("integ_developer")).toBe(developerIntegration);
    expect(registry.list()).toEqual([projectIntegration, developerIntegration]);
    expect(registry.listByScope("developer")).toEqual([developerIntegration]);
    expect(registry.listByEntity("project")).toEqual([projectIntegration]);
    expect(registry.listByEntity("developer")).toEqual([developerIntegration]);
  });

  it("throws when the same id is registered twice", () => {
    const registry = new ProjectIntegrationDefinitionRegistry().register(makeDefinition());
    expect(() => registry.register(makeDefinition())).toThrow(/already registered/);
  });

  it("resolves an unknown id to undefined", () => {
    expect(new ProjectIntegrationDefinitionRegistry().resolve("integ_missing")).toBeUndefined();
  });
});

describe("registry data model", () => {
  it("builds an empty registry and appends immutably", () => {
    const empty = emptyProjectIntegrationRegistry("cat", "Catalogue");
    expect(empty).toEqual({ id: "cat", name: "Catalogue", entries: [] });

    const appended = addProjectIntegrationEntry(empty, makeEntry());
    expect(empty.entries).toHaveLength(0);
    expect(appended.entries).toHaveLength(1);
  });

  it("finds entries by integration id and filters enabled entries", () => {
    const registry = makeRegistry({
      entries: [makeEntry(), makeEntry({ enabled: true })],
    });
    expect(findProjectIntegrationEntry(registry, "integ_coralina")).toBe(registry.entries[0]);
    expect(listEnabledProjectIntegrationEntries(registry)).toHaveLength(1);
  });
});

describe("result and history builders", () => {
  it("derives ok/state/outcome from reconciled stats", () => {
    const result = createProjectIntegrationResult<{ id: string }>({
      data: [{ id: "p1" }],
      issues: [{ code: "x", message: "warn", severity: "warning" }],
      stats: { ...emptyProjectIntegrationStats(), stages: 4, steps: 5, completed: 5 },
      metadata: {
        integrationId: "integ_coralina",
        stageCount: 4,
        stepCount: 5,
        entityCount: 2,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.state).toBe("succeeded");
    expect(result.outcome).toBe("success");
    expect(result.stats.warnings).toBe(1);
    expect(result.stats.errors).toBe(0);
  });

  it("marks a result not ok when a blocking error is present", () => {
    const result = createProjectIntegrationResult<never>({
      data: [],
      issues: [{ code: "e", message: "bad", severity: "error" }],
      stats: emptyProjectIntegrationStats(),
      metadata: { integrationId: "integ_x", stageCount: 0, stepCount: 0, entityCount: 0 },
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe("failed");
    expect(result.stats.errors).toBe(1);
  });

  it("appends history immutably and reads the latest entry", () => {
    const history = emptyProjectIntegrationHistory("integ_coralina");
    const entry = {
      integrationId: "integ_coralina",
      state: "succeeded" as const,
      outcome: "success" as const,
      stats: emptyProjectIntegrationStats(),
    };
    const appended = appendProjectIntegrationHistory(history, entry);
    expect(history.entries).toHaveLength(0);
    expect(appended.entries).toHaveLength(1);
    expect(latestProjectIntegrationHistoryEntry(appended)).toBe(entry);
    expect(latestProjectIntegrationHistoryEntry(history)).toBeUndefined();
  });
});
