import { describe, expect, it } from "vitest";

import {
  buildForeverProjectTemplate,
  buildProjectBundle,
  buildProjectPackage,
  isProjectBundleComplete,
  missingProjectComponentKinds,
  projectLayout,
  providedProjectComponentKinds,
} from "..";
import { makePackage } from "./fixtures";

describe("project bundle", () => {
  it("marks each template component with whether the package provides it", () => {
    const pkg = buildProjectPackage("coralina", {
      provides: ["identity", "sources"],
      entities: ["project"],
    });
    const bundle = buildProjectBundle(pkg);
    const identity = bundle.components.find((c) => c.component.kind === "identity");
    const pipeline = bundle.components.find((c) => c.component.kind === "pipeline");
    expect(identity?.provided).toBe(true);
    expect(pipeline?.provided).toBe(false);
  });

  it("reports missing required components", () => {
    const pkg = buildProjectPackage("coralina", {
      provides: ["identity"],
      entities: ["project"],
    });
    const missing = missingProjectComponentKinds(buildProjectBundle(pkg));
    expect(missing).toContain("sources");
    expect(missing).toContain("verification");
    expect(missing).not.toContain("connector"); // optional
  });

  it("a complete package provides every required component", () => {
    const bundle = buildProjectBundle(makePackage());
    expect(missingProjectComponentKinds(bundle)).toEqual([]);
    expect(isProjectBundleComplete(bundle)).toBe(true);
    expect(providedProjectComponentKinds(bundle)).toHaveLength(8);
  });

  it("a package missing only the optional connector is still complete", () => {
    const pkg = makePackage({
      provides: [
        "identity",
        "sources",
        "pipeline",
        "canonical",
        "integration",
        "references",
        "verification",
      ],
    });
    expect(isProjectBundleComplete(buildProjectBundle(pkg))).toBe(true);
  });

  it("uses a package layout override when present, else the template layout", () => {
    const template = buildForeverProjectTemplate();
    const withDefault = buildProjectBundle(makePackage());
    expect(withDefault.layout).toEqual(template.layout);

    const override = projectLayout("custom/root", []);
    const withOverride = buildProjectBundle(makePackage({ layout: override }));
    expect(withOverride.layout).toEqual(override);
  });

  it("is a pure, non-mutating function of its inputs", () => {
    const pkg = makePackage();
    const snapshot = JSON.stringify(pkg);
    const a = buildProjectBundle(pkg);
    const b = buildProjectBundle(pkg);
    expect(a).toEqual(b);
    expect(JSON.stringify(pkg)).toBe(snapshot);
  });
});
