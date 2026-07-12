import { describe, expect, it } from "vitest";

import {
  emptyProjectIntegrationStats,
  integrationStageStepCycle,
  isNonEmptyString,
  listProjectIntegrationSteps,
  mergeProjectIntegrationStats,
  orderIntegrationStageSteps,
  projectIntegrationConnectorIds,
  projectIntegrationDefinitionKey,
  projectIntegrationIdentityKey,
  projectIntegrationPipelineIds,
  projectIntegrationSourceIds,
  projectIntegrationStageCount,
  projectIntegrationStepCount,
  projectIntegrationStepEntityKinds,
  projectIntegrationSystems,
  projectIntegrationStage,
  projectIntegrationStep,
  sumProjectIntegrationStats,
  type ProjectIntegrationStats,
} from "..";
import { makeDefinition, makeIdentity } from "./fixtures";

describe("deterministic helpers", () => {
  it("guards non-empty strings", () => {
    expect(isNonEmptyString("x")).toBe(true);
    expect(isNonEmptyString("   ")).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(0)).toBe(false);
  });

  it("builds a natural key independent of the surrogate id", () => {
    const key = projectIntegrationIdentityKey(makeIdentity());
    expect(key).toBe("project:coralina");
    expect(projectIntegrationIdentityKey(makeIdentity({ id: "integ_other" }))).toBe(key);
    expect(projectIntegrationDefinitionKey(makeDefinition())).toBe(key);
  });

  it("counts stages and steps and flattens steps in declared order", () => {
    const definition = makeDefinition();
    expect(projectIntegrationStageCount(definition)).toBe(4);
    expect(projectIntegrationStepCount(definition)).toBe(5);
    expect(listProjectIntegrationSteps(definition).map((s) => s.id)).toEqual([
      "bind_source",
      "bind_connector",
      "run_import",
      "sync_database",
      "verify_ready",
    ]);
  });

  it("collects distinct source, connector, pipeline, system, and entity references", () => {
    const definition = makeDefinition();
    expect(projectIntegrationSourceIds(definition)).toEqual(["src_developer_website"]);
    expect(projectIntegrationConnectorIds(definition)).toEqual(["conn_developer_website"]);
    expect(projectIntegrationPipelineIds(definition)).toEqual(["pipe_coralina_import"]);
    expect(projectIntegrationSystems(definition)).toEqual(["forever_database"]);
    expect(projectIntegrationStepEntityKinds(definition)).toEqual(["project"]);
  });

  it("collects references in first-seen order without duplicates", () => {
    const stage = projectIntegrationStage("acquire", "Acquire", "acquire", [
      projectIntegrationStep("a", "A", "source", { sourceId: "src_b" }),
      projectIntegrationStep("b", "B", "source", { sourceId: "src_a" }),
      projectIntegrationStep("c", "C", "source", { sourceId: "src_b" }),
    ]);
    const definition = makeDefinition({ stages: [stage] });
    expect(projectIntegrationSourceIds(definition)).toEqual(["src_b", "src_a"]);
  });
});

describe("step dependency ordering", () => {
  it("orders steps by their declared dependencies, stably", () => {
    const stage = projectIntegrationStage("s", "S", "acquire", [
      projectIntegrationStep("c", "C", "verify", { dependsOn: ["b"] }),
      projectIntegrationStep("b", "B", "pipeline", { dependsOn: ["a"] }),
      projectIntegrationStep("a", "A", "source"),
    ]);
    expect(orderIntegrationStageSteps(stage).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(integrationStageStepCycle(stage)).toBeUndefined();
  });

  it("preserves declared order among independent steps", () => {
    const stage = projectIntegrationStage("s", "S", "acquire", [
      projectIntegrationStep("a", "A", "source"),
      projectIntegrationStep("b", "B", "source"),
      projectIntegrationStep("c", "C", "source"),
    ]);
    expect(orderIntegrationStageSteps(stage).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("detects a dependency cycle and stays total when ordering one", () => {
    const stage = projectIntegrationStage("s", "S", "acquire", [
      projectIntegrationStep("a", "A", "source", { dependsOn: ["c"] }),
      projectIntegrationStep("b", "B", "pipeline", { dependsOn: ["a"] }),
      projectIntegrationStep("c", "C", "verify", { dependsOn: ["b"] }),
    ]);
    const cycle = integrationStageStepCycle(stage);
    expect(cycle).toBeDefined();
    expect(cycle?.[0]).toBe(cycle?.[cycle.length - 1]);
    expect(orderIntegrationStageSteps(stage).map((s) => s.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("ignores dependencies pointing outside the stage when ordering", () => {
    const stage = projectIntegrationStage("s", "S", "acquire", [
      projectIntegrationStep("a", "A", "source", { dependsOn: ["elsewhere"] }),
    ]);
    expect(orderIntegrationStageSteps(stage).map((s) => s.id)).toEqual(["a"]);
    expect(integrationStageStepCycle(stage)).toBeUndefined();
  });
});

describe("stats combiners", () => {
  it("merges and sums stats field-by-field", () => {
    const a: ProjectIntegrationStats = {
      ...emptyProjectIntegrationStats(),
      stages: 1,
      steps: 2,
      completed: 2,
    };
    const b: ProjectIntegrationStats = {
      ...emptyProjectIntegrationStats(),
      stages: 1,
      steps: 1,
      failed: 1,
    };
    expect(mergeProjectIntegrationStats(a, b)).toEqual({
      stages: 2,
      steps: 3,
      completed: 2,
      skipped: 0,
      failed: 1,
      warnings: 0,
      errors: 0,
    });
    expect(sumProjectIntegrationStats([a, b])).toEqual(mergeProjectIntegrationStats(a, b));
    expect(sumProjectIntegrationStats([])).toEqual(emptyProjectIntegrationStats());
  });
});
