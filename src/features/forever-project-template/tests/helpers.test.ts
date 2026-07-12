import { describe, expect, it } from "vitest";

import {
  buildForeverProjectTemplate,
  buildProjectPackage,
  findProjectComponent,
  foreverProjectReferences,
  isNonEmptyString,
  projectComponentCount,
  projectComponentKinds,
  projectPackageIdentityKey,
  projectPackageKey,
  projectReferencedComponents,
  projectTemplateKey,
  requiredProjectComponents,
  summarizeProjectConformance,
} from "..";
import { makePackage } from "./fixtures";

describe("deterministic helpers", () => {
  it("reuses the RC4.0 non-empty-string guard", () => {
    expect(isNonEmptyString("x")).toBe(true);
    expect(isNonEmptyString("  ")).toBe(false);
    expect(isNonEmptyString(0)).toBe(false);
  });

  it("builds natural keys independent of the surrogate id", () => {
    const pkg = buildProjectPackage("coralina", { provides: ["identity"], entities: ["project"] });
    expect(projectPackageKey(pkg)).toBe("project:coralina");
    expect(projectPackageIdentityKey(pkg.identity)).toBe("project:coralina");
    expect(projectTemplateKey(buildForeverProjectTemplate().identity)).toBe("forever-project");
  });

  it("counts and lists template components", () => {
    const template = buildForeverProjectTemplate();
    expect(projectComponentCount(template)).toBe(8);
    expect(requiredProjectComponents(template)).toHaveLength(7);
    expect(projectComponentKinds(template)).toContain("integration");
    expect(findProjectComponent(template, "sources")?.foundation).toBe("rc3.3");
    expect(findProjectComponent(template, "missing" as never)).toBeUndefined();
  });

  it("collects distinct components referenced by a reference set", () => {
    const kinds = projectReferencedComponents(foreverProjectReferences());
    expect(kinds).toContain("integration");
    expect(kinds).toContain("sources");
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("summarizes conformance: complete, then missing and extra", () => {
    const complete = summarizeProjectConformance(buildForeverProjectTemplate(), makePackage());
    expect(complete.missing).toEqual([]);
    expect(complete.extra).toEqual([]);
    expect(complete.satisfied).toHaveLength(7);

    const pkg = buildProjectPackage("coralina", {
      provides: ["identity", "spurious" as never],
      entities: ["project"],
    });
    const partial = summarizeProjectConformance(buildForeverProjectTemplate(), pkg);
    expect(partial.missing).toContain("sources");
    expect(partial.extra).toEqual(["spurious"]);
  });
});
