import { describe, expect, it } from "vitest";

import {
  addConnectorEntry,
  compareConnectorVersion,
  connectorVersion,
  validateConnectorRegistry,
} from "..";
import { makeEntry, makeRegistry } from "./fixtures";

describe("deterministic foundation", () => {
  it("comparison returns equal output for equal input", () => {
    const a = connectorVersion(1, 4, 2);
    const b = connectorVersion(1, 4, 9);
    expect(compareConnectorVersion(a, b)).toBe(compareConnectorVersion(a, b));
    expect(Math.sign(compareConnectorVersion(a, b))).toBe(-1);
  });

  it("validateConnectorRegistry is a pure function of its registry", () => {
    const registry = makeRegistry();
    const first = validateConnectorRegistry(registry);
    const second = validateConnectorRegistry(registry);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("does not mutate the registry it validates", () => {
    const registry = makeRegistry({ entries: [makeEntry(), makeEntry({ status: "ready" })] });
    const snapshot = structuredClone(registry);
    validateConnectorRegistry(registry);
    expect(registry).toEqual(snapshot);
  });

  it("appends entries without mutating the input", () => {
    const registry = makeRegistry();
    const snapshot = structuredClone(registry);
    addConnectorEntry(registry, makeEntry({ status: "ready" }));
    expect(registry).toEqual(snapshot);
  });
});
