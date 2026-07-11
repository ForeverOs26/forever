import { describe, expect, it } from "vitest";

import { addSourceEntry, compareSourceVersion, sourceVersion, validateSourceRegistry } from "..";
import { makeEntry, makeRegistry } from "./fixtures";

describe("deterministic foundation", () => {
  it("comparison returns equal output for equal input", () => {
    const a = sourceVersion(1, 4, 2);
    const b = sourceVersion(1, 4, 9);
    expect(compareSourceVersion(a, b)).toBe(compareSourceVersion(a, b));
    expect(Math.sign(compareSourceVersion(a, b))).toBe(-1);
  });

  it("validateSourceRegistry is a pure function of its registry", () => {
    const registry = makeRegistry();
    const first = validateSourceRegistry(registry);
    const second = validateSourceRegistry(registry);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("does not mutate the registry it validates", () => {
    const registry = makeRegistry({ entries: [makeEntry(), makeEntry({ status: "enabled" })] });
    const snapshot = structuredClone(registry);
    validateSourceRegistry(registry);
    expect(registry).toEqual(snapshot);
  });

  it("appends entries without mutating the input", () => {
    const registry = makeRegistry();
    const snapshot = structuredClone(registry);
    addSourceEntry(registry, makeEntry({ status: "enabled" }));
    expect(registry).toEqual(snapshot);
  });
});
