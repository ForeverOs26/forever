import { describe, expect, it } from "vitest";

import { ReadinessRegistry } from "..";
import { makeContestedReadinessReport, makeReadinessReport, runReadiness } from "./fixtures";

describe("registry", () => {
  it("registers, resolves, and lists in insertion order", () => {
    const ready = makeReadinessReport();
    const blocked = { ...makeContestedReadinessReport(), id: "rrep_coralina-contested" };
    const registry = new ReadinessRegistry().register(ready).register(blocked);
    expect(registry.has(ready.id)).toBe(true);
    expect(registry.resolve(ready.id)).toBe(ready);
    expect(registry.resolve("rrep_missing")).toBeUndefined();
    expect(registry.list()).toEqual([ready, blocked]);
    expect(registry.listByProject("proj_coralina")).toEqual([ready, blocked]);
    expect(registry.listByProject("proj_other")).toEqual([]);
  });

  it("partitions by standing", () => {
    const ready = makeReadinessReport();
    const blocked = { ...makeContestedReadinessReport(), id: "rrep_coralina-contested" };
    const indeterminate = {
      ...runReadiness({ record: undefined }).data[0],
      id: "rrep_coralina-undetermined",
    };
    const registry = new ReadinessRegistry()
      .register(ready)
      .register(blocked)
      .register(indeterminate);
    expect(registry.listReady()).toEqual([ready]);
    expect(registry.listBlocked()).toEqual([blocked]);
    expect(registry.listByStanding("indeterminate")).toEqual([indeterminate]);
  });

  it("re-registering one report id clashes at wiring time", () => {
    const registry = new ReadinessRegistry().register(makeReadinessReport());
    expect(() => registry.register(makeReadinessReport())).toThrowError(
      /already registered for rrep_coralina/,
    );
  });
});
