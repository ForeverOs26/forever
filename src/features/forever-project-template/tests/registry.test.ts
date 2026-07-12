import { describe, expect, it } from "vitest";

import { buildProjectPackage, ProjectPackageRegistry } from "..";

describe("in-memory package registry", () => {
  it("registers and resolves a package by id", () => {
    const registry = new ProjectPackageRegistry();
    const pkg = buildProjectPackage("coralina", { provides: ["identity"], entities: ["project"] });
    registry.register(pkg);
    expect(registry.has("pkg_coralina")).toBe(true);
    expect(registry.resolve("pkg_coralina")).toBe(pkg);
    expect(registry.resolve("pkg_absent")).toBeUndefined();
  });

  it("throws on a duplicate id so a clash surfaces at wiring time", () => {
    const registry = new ProjectPackageRegistry();
    registry.register(
      buildProjectPackage("coralina", { provides: ["identity"], entities: ["project"] }),
    );
    expect(() =>
      registry.register(
        buildProjectPackage("coralina", { provides: ["sources"], entities: ["project"] }),
      ),
    ).toThrow(/already registered/);
  });

  it("lists packages in insertion order", () => {
    const registry = new ProjectPackageRegistry();
    registry.register(
      buildProjectPackage("alpha", { provides: ["identity"], entities: ["project"] }),
    );
    registry.register(
      buildProjectPackage("beta", { provides: ["identity"], entities: ["project"] }),
    );
    expect(registry.list().map((p) => p.identity.slug)).toEqual(["alpha", "beta"]);
  });

  it("filters by scope", () => {
    const registry = new ProjectPackageRegistry();
    registry.register(
      buildProjectPackage("alpha", {
        scope: "project",
        provides: ["identity"],
        entities: ["project"],
      }),
    );
    registry.register(
      buildProjectPackage("beta", {
        scope: "developer",
        provides: ["identity"],
        entities: ["project"],
      }),
    );
    expect(registry.listByScope("developer").map((p) => p.identity.slug)).toEqual(["beta"]);
  });

  it("filters by template", () => {
    const registry = new ProjectPackageRegistry();
    registry.register(
      buildProjectPackage("alpha", { provides: ["identity"], entities: ["project"] }),
    );
    registry.register(
      buildProjectPackage("beta", {
        templateId: "tmpl_other",
        provides: ["identity"],
        entities: ["project"],
      }),
    );
    expect(registry.listByTemplate("tmpl_other").map((p) => p.identity.slug)).toEqual(["beta"]);
  });

  it("filters by provided component", () => {
    const registry = new ProjectPackageRegistry();
    registry.register(
      buildProjectPackage("alpha", { provides: ["identity"], entities: ["project"] }),
    );
    registry.register(
      buildProjectPackage("beta", { provides: ["sources"], entities: ["project"] }),
    );
    expect(registry.listByComponent("sources").map((p) => p.identity.slug)).toEqual(["beta"]);
  });
});
