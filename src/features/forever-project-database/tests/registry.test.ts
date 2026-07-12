import { describe, expect, it } from "vitest";

import { ProjectRegistry, describeProjectField } from "..";
import { OTHER_SOURCE_ID, SOURCE_ID, makeField, makeRecord, makeValue } from "./fixtures";

function otherRecord() {
  const identity = {
    id: "prec_seaview",
    slug: "seaview",
    name: "Seaview",
    projectId: "proj_seaview",
  };
  const field = describeProjectField({ projectSlug: "seaview", path: "general.name" });
  return makeRecord({
    identity,
    status: "draft",
    fields: [{ ...field, values: [makeValue({ sourceIds: [OTHER_SOURCE_ID] })] }],
    revisions: [],
    sourceIds: undefined,
  });
}

describe("ProjectRegistry", () => {
  it("registers and resolves canonical records by project id", () => {
    const registry = new ProjectRegistry().register(makeRecord());
    expect(registry.has("proj_coralina")).toBe(true);
    expect(registry.resolve("proj_coralina")?.identity.slug).toBe("coralina");
    expect(registry.resolve("proj_missing")).toBeUndefined();
    expect(registry.has("proj_missing")).toBe(false);
  });

  it("enforces one canonical record per project at wiring time", () => {
    const registry = new ProjectRegistry().register(makeRecord());
    expect(() => registry.register(makeRecord())).toThrowError(
      /already registered for proj_coralina/,
    );
  });

  it("lists records in insertion order", () => {
    const registry = new ProjectRegistry().register(otherRecord()).register(makeRecord());
    expect(registry.list().map((record) => record.identity.projectId)).toEqual([
      "proj_seaview",
      "proj_coralina",
    ]);
  });

  it("filters by standing, canonical section, and traced source", () => {
    const registry = new ProjectRegistry().register(makeRecord()).register(otherRecord());
    expect(registry.listByStatus("active").map((r) => r.identity.slug)).toEqual(["coralina"]);
    expect(registry.listByStatus("draft").map((r) => r.identity.slug)).toEqual(["seaview"]);
    expect(registry.listBySection("pricing").map((r) => r.identity.slug)).toEqual(["coralina"]);
    expect(registry.listBySection("general").map((r) => r.identity.slug)).toEqual(["seaview"]);
    expect(registry.listBySection("legal")).toEqual([]);
    expect(registry.listBySource(SOURCE_ID).map((r) => r.identity.slug)).toEqual(["coralina"]);
    expect(registry.listBySource(OTHER_SOURCE_ID).map((r) => r.identity.slug)).toEqual(["seaview"]);
  });

  it("holds no global state: independent registries never share records", () => {
    const first = new ProjectRegistry().register(makeRecord());
    const second = new ProjectRegistry();
    expect(first.has("proj_coralina")).toBe(true);
    expect(second.has("proj_coralina")).toBe(false);
    expect(second.list()).toEqual([]);
  });
});
