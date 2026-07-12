import { describe, expect, it } from "vitest";

import {
  buildProjectPackage,
  FOREVER_PROJECT_TEMPLATE_ID,
  projectPackageCoversEntity,
  projectPackageProvidesComponent,
} from "..";

describe("project package builder", () => {
  it("derives identity, project id, and template from the slug with defaults", () => {
    const pkg = buildProjectPackage("Coralina Kamala");
    expect(pkg.identity.id).toBe("pkg_coralina-kamala");
    expect(pkg.identity.slug).toBe("coralina-kamala");
    expect(pkg.projectId).toBe("proj_coralina-kamala");
    expect(pkg.templateId).toBe(FOREVER_PROJECT_TEMPLATE_ID);
    expect(pkg.provides).toEqual([]);
    expect(pkg.entities).toEqual([]);
  });

  it("honours provided components, entities, name, and scope", () => {
    const pkg = buildProjectPackage("coralina", {
      name: "Coralina",
      scope: "project",
      provides: ["identity", "sources"],
      entities: ["project", "document"],
    });
    expect(pkg.identity.name).toBe("Coralina");
    expect(pkg.provides).toEqual(["identity", "sources"]);
    expect(pkg.entities).toEqual(["project", "document"]);
  });

  it("omits optional layout and metadata unless supplied", () => {
    const pkg = buildProjectPackage("coralina");
    expect("layout" in pkg).toBe(false);
    expect("metadata" in pkg).toBe(false);
  });

  it("reports provided components and covered entities", () => {
    const pkg = buildProjectPackage("coralina", {
      provides: ["sources"],
      entities: ["media"],
    });
    expect(projectPackageProvidesComponent(pkg, "sources")).toBe(true);
    expect(projectPackageProvidesComponent(pkg, "pipeline")).toBe(false);
    expect(projectPackageCoversEntity(pkg, "media")).toBe(true);
    expect(projectPackageCoversEntity(pkg, "project")).toBe(false);
  });

  it("is a pure function of its inputs", () => {
    const build = () =>
      buildProjectPackage("coralina", { provides: ["identity"], entities: ["project"] });
    expect(build()).toEqual(build());
  });
});
