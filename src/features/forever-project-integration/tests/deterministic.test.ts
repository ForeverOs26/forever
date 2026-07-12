import { describe, expect, it } from "vitest";

import {
  addProjectIntegrationEntry,
  compareProjectIntegrationVersion,
  createProjectIntegrationResult,
  emptyProjectIntegrationStats,
  orderIntegrationStageSteps,
  projectIntegrationVersion,
  validateProjectIntegrationRegistry,
} from "..";
import { makeDefinition, makeEntry, makeRegistry } from "./fixtures";

describe("deterministic foundation", () => {
  it("comparison returns equal output for equal input", () => {
    const a = projectIntegrationVersion(1, 4, 2);
    const b = projectIntegrationVersion(1, 4, 9);
    expect(compareProjectIntegrationVersion(a, b)).toBe(compareProjectIntegrationVersion(a, b));
    expect(Math.sign(compareProjectIntegrationVersion(a, b))).toBe(-1);
  });

  it("validateProjectIntegrationRegistry is a pure function of its registry", () => {
    const registry = makeRegistry();
    const first = validateProjectIntegrationRegistry(registry);
    const second = validateProjectIntegrationRegistry(registry);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("does not mutate the registry it validates", () => {
    const registry = makeRegistry({ entries: [makeEntry(), makeEntry({ enabled: true })] });
    const snapshot = structuredClone(registry);
    validateProjectIntegrationRegistry(registry);
    expect(registry).toEqual(snapshot);
  });

  it("appends entries without mutating the input", () => {
    const registry = makeRegistry();
    const snapshot = structuredClone(registry);
    addProjectIntegrationEntry(registry, makeEntry({ enabled: true }));
    expect(registry).toEqual(snapshot);
  });

  it("orders a stage's steps without mutating them", () => {
    const definition = makeDefinition();
    const stage = definition.stages[0];
    const snapshot = structuredClone(stage);
    orderIntegrationStageSteps(stage);
    expect(stage).toEqual(snapshot);
  });

  it("builds a result that is a pure function of its inputs", () => {
    const build = () =>
      createProjectIntegrationResult<{ id: string }>({
        data: [{ id: "p1" }],
        issues: [{ code: "w", message: "warn", severity: "warning" }],
        stats: { ...emptyProjectIntegrationStats(), stages: 1, steps: 1, completed: 1 },
        metadata: {
          integrationId: "integ_coralina",
          stageCount: 1,
          stepCount: 1,
          entityCount: 1,
        },
      });
    expect(build()).toEqual(build());
  });
});
