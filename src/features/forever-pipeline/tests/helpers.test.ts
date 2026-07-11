import { describe, expect, it } from "vitest";

import {
  emptyPipelineStats,
  isNonEmptyString,
  listPipelineSteps,
  mergePipelineStats,
  orderStageSteps,
  pipelineConnectorIds,
  pipelineDefinitionKey,
  pipelineIdentityKey,
  pipelineSourceIds,
  pipelineStageCount,
  pipelineStepCount,
  pipelineStepEntityKinds,
  pipelineStage,
  pipelineStep,
  stageStepCycle,
  sumPipelineStats,
  type PipelineStats,
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
    const key = pipelineIdentityKey(makeIdentity());
    expect(key).toBe("import:coralina-import");
    expect(pipelineIdentityKey(makeIdentity({ id: "pipe_other" }))).toBe(key);
    expect(pipelineDefinitionKey(makeDefinition())).toBe(key);
  });

  it("counts stages and steps and flattens steps in declared order", () => {
    const definition = makeDefinition();
    expect(pipelineStageCount(definition)).toBe(4);
    expect(pipelineStepCount(definition)).toBe(5);
    expect(listPipelineSteps(definition).map((s) => s.id)).toEqual([
      "acquire",
      "import_project",
      "normalize_project",
      "validate_project",
      "sync_database",
    ]);
  });

  it("collects distinct source, connector, and entity references in first-seen order", () => {
    const definition = makeDefinition();
    expect(pipelineSourceIds(definition)).toEqual(["src_developer_website"]);
    expect(pipelineConnectorIds(definition)).toEqual(["conn_developer_website"]);
    expect(pipelineStepEntityKinds(definition)).toEqual(["project"]);
  });
});

describe("step dependency ordering", () => {
  it("orders steps by their declared dependencies, stably", () => {
    const stage = pipelineStage("s", "S", "ingest", [
      pipelineStep("c", "C", "validate", { dependsOn: ["b"] }),
      pipelineStep("b", "B", "normalize", { dependsOn: ["a"] }),
      pipelineStep("a", "A", "import"),
    ]);
    expect(orderStageSteps(stage).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(stageStepCycle(stage)).toBeUndefined();
  });

  it("preserves declared order among independent steps", () => {
    const stage = pipelineStage("s", "S", "ingest", [
      pipelineStep("a", "A", "import"),
      pipelineStep("b", "B", "import"),
      pipelineStep("c", "C", "import"),
    ]);
    expect(orderStageSteps(stage).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("detects a dependency cycle and stays total when ordering one", () => {
    const stage = pipelineStage("s", "S", "ingest", [
      pipelineStep("a", "A", "import", { dependsOn: ["c"] }),
      pipelineStep("b", "B", "normalize", { dependsOn: ["a"] }),
      pipelineStep("c", "C", "validate", { dependsOn: ["b"] }),
    ]);
    const cycle = stageStepCycle(stage);
    expect(cycle).toBeDefined();
    expect(cycle?.[0]).toBe(cycle?.[cycle.length - 1]);
    // Ordering a cyclic stage still returns every step exactly once.
    expect(orderStageSteps(stage).map((s) => s.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("ignores dependencies pointing outside the stage when ordering", () => {
    const stage = pipelineStage("s", "S", "ingest", [
      pipelineStep("a", "A", "import", { dependsOn: ["elsewhere"] }),
    ]);
    expect(orderStageSteps(stage).map((s) => s.id)).toEqual(["a"]);
    expect(stageStepCycle(stage)).toBeUndefined();
  });
});

describe("stats combiners", () => {
  it("merges and sums stats field-by-field", () => {
    const a: PipelineStats = { ...emptyPipelineStats(), stages: 1, steps: 2, completed: 2 };
    const b: PipelineStats = { ...emptyPipelineStats(), stages: 1, steps: 1, failed: 1 };
    expect(mergePipelineStats(a, b)).toEqual({
      stages: 2,
      steps: 3,
      completed: 2,
      skipped: 0,
      failed: 1,
      warnings: 0,
      errors: 0,
    });
    expect(sumPipelineStats([a, b])).toEqual(mergePipelineStats(a, b));
    expect(sumPipelineStats([])).toEqual(emptyPipelineStats());
  });
});
