import { describe, expect, it } from "vitest";

import {
  addPipelineEntry,
  comparePipelineVersion,
  orderStageSteps,
  pipelineVersion,
  validatePipelineRegistry,
} from "..";
import { makeDefinition, makeEntry, makeRegistry } from "./fixtures";

describe("deterministic foundation", () => {
  it("comparison returns equal output for equal input", () => {
    const a = pipelineVersion(1, 4, 2);
    const b = pipelineVersion(1, 4, 9);
    expect(comparePipelineVersion(a, b)).toBe(comparePipelineVersion(a, b));
    expect(Math.sign(comparePipelineVersion(a, b))).toBe(-1);
  });

  it("validatePipelineRegistry is a pure function of its registry", () => {
    const registry = makeRegistry();
    const first = validatePipelineRegistry(registry);
    const second = validatePipelineRegistry(registry);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("does not mutate the registry it validates", () => {
    const registry = makeRegistry({ entries: [makeEntry(), makeEntry({ enabled: true })] });
    const snapshot = structuredClone(registry);
    validatePipelineRegistry(registry);
    expect(registry).toEqual(snapshot);
  });

  it("appends entries without mutating the input", () => {
    const registry = makeRegistry();
    const snapshot = structuredClone(registry);
    addPipelineEntry(registry, makeEntry({ enabled: true }));
    expect(registry).toEqual(snapshot);
  });

  it("orders a stage's steps without mutating them", () => {
    const definition = makeDefinition();
    const stage = definition.stages[0];
    const snapshot = structuredClone(stage);
    orderStageSteps(stage);
    expect(stage).toEqual(snapshot);
  });
});
