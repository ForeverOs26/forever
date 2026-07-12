import { describe, expect, it } from "vitest";

import {
  buildForeverProjectTemplate,
  buildProjectBundle,
  buildProjectPackage,
  partitionProjectTemplateIssues,
  validateProjectBundle,
  validateProjectCatalog,
  validateProjectPackage,
  validateProjectTemplate,
  type ProjectPackage,
} from "..";
import { makeCatalog, makeEntry, makePackage } from "./fixtures";

describe("template validation", () => {
  it("passes the canonical template with no errors", () => {
    const { errors } = partitionProjectTemplateIssues(
      validateProjectTemplate(buildForeverProjectTemplate()),
    );
    expect(errors).toEqual([]);
  });

  it("flags empty, duplicate, and unknown components", () => {
    const empty = buildForeverProjectTemplate();
    empty.components = [];
    expect(validateProjectTemplate(empty).map((i) => i.code)).toContain("no_components");

    const bad = buildForeverProjectTemplate();
    bad.components = [
      bad.components[0],
      { ...bad.components[0] },
      { kind: "bogus" as never, name: "B", foundation: "rc3.0", required: false },
    ];
    const codes = validateProjectTemplate(bad).map((i) => i.code);
    expect(codes).toContain("duplicate_component_kind");
    expect(codes).toContain("unknown_component_kind");
  });
});

describe("package validation", () => {
  it("passes a complete package with no errors", () => {
    const { errors } = partitionProjectTemplateIssues(validateProjectPackage(makePackage()));
    expect(errors).toEqual([]);
  });

  it("flags empty, duplicate, and unknown provided components and entities", () => {
    const bare = buildProjectPackage("coralina");
    const bareCodes = validateProjectPackage(bare).map((i) => i.code);
    expect(bareCodes).toContain("no_provided_components");
    expect(bareCodes).toContain("no_covered_entities");

    const dupe = buildProjectPackage("coralina", {
      provides: ["identity", "identity", "bogus" as never],
      entities: ["project"],
    });
    const dupeCodes = validateProjectPackage(dupe).map((i) => i.code);
    expect(dupeCodes).toContain("duplicate_provided_component");
    expect(dupeCodes).toContain("unknown_provided_component");
  });

  it("warns (never rewrites) on an unnormalized slug and flags an unknown scope", () => {
    const unnormalized: ProjectPackage = {
      ...makePackage(),
      identity: { id: "pkg_x", slug: "Not Normal", name: "X", scope: "project" },
    };
    const warning = validateProjectPackage(unnormalized).find(
      (i) => i.code === "unnormalized_package_slug",
    );
    expect(warning?.severity).toBe("warning");

    const badScope: ProjectPackage = {
      ...makePackage(),
      identity: { id: "pkg_x", slug: "x", name: "X", scope: "galaxy" as never },
    };
    expect(validateProjectPackage(badScope).map((i) => i.code)).toContain("unknown_package_scope");
  });
});

describe("bundle validation", () => {
  it("passes a complete bundle with no errors", () => {
    const { errors } = partitionProjectTemplateIssues(
      validateProjectBundle(buildProjectBundle(makePackage())),
    );
    expect(errors).toEqual([]);
  });

  it("errors when a required component is not provided", () => {
    const pkg = buildProjectPackage("coralina", { provides: ["identity"], entities: ["project"] });
    const codes = validateProjectBundle(buildProjectBundle(pkg)).map((i) => i.code);
    expect(codes).toContain("missing_required_component");
  });

  it("warns on a template mismatch and an extra provided component", () => {
    const mismatch = buildProjectPackage("coralina", {
      templateId: "tmpl_other",
      provides: [
        "identity",
        "sources",
        "pipeline",
        "canonical",
        "integration",
        "references",
        "verification",
      ],
      entities: ["project"],
    });
    expect(validateProjectBundle(buildProjectBundle(mismatch)).map((i) => i.code)).toContain(
      "bundle_template_mismatch",
    );

    const extra = makePackage({ provides: [...makePackage().provides, "spurious" as never] });
    expect(validateProjectBundle(buildProjectBundle(extra)).map((i) => i.code)).toContain(
      "extra_provided_component",
    );
  });
});

describe("catalogue validation", () => {
  it("passes a coherent catalogue", () => {
    expect(validateProjectCatalog(makeCatalog()).valid).toBe(true);
  });

  it("flags a missing id, duplicate ids/keys, and a non-boolean enabled flag", () => {
    expect(validateProjectCatalog(makeCatalog({ id: "" })).errors.map((e) => e.code)).toContain(
      "missing_catalog_id",
    );

    const dupes = validateProjectCatalog(makeCatalog({ entries: [makeEntry(), makeEntry()] }));
    const dupeCodes = dupes.errors.map((e) => e.code);
    expect(dupeCodes).toContain("duplicate_package_id");
    expect(dupeCodes).toContain("duplicate_package_key");

    const badFlag = makeCatalog({ entries: [makeEntry({ enabled: "yes" as never })] });
    expect(validateProjectCatalog(badFlag).errors.map((e) => e.code)).toContain(
      "invalid_enabled_flag",
    );
  });

  it("never throws on deeply malformed input", () => {
    const broken = {
      id: undefined,
      entries: [{ enabled: null, package: { identity: {}, provides: null, entities: undefined } }],
    } as never;
    expect(() => validateProjectCatalog(broken)).not.toThrow();
    expect(validateProjectCatalog(broken).valid).toBe(false);
  });
});
