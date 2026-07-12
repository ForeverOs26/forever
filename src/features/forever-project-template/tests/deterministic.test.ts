import { describe, expect, it } from "vitest";

import {
  addProjectCatalogEntry,
  buildForeverProjectTemplate,
  buildProjectBundle,
  compareProjectPackageVersion,
  projectPackageVersion,
  validateProjectCatalog,
} from "..";
import { makeCatalog, makeEntry, makePackage } from "./fixtures";

describe("deterministic foundation", () => {
  it("version comparison returns equal output for equal input", () => {
    const a = projectPackageVersion(1, 4, 2);
    const b = projectPackageVersion(1, 4, 9);
    expect(compareProjectPackageVersion(a, b)).toBe(compareProjectPackageVersion(a, b));
    expect(Math.sign(compareProjectPackageVersion(a, b))).toBe(-1);
  });

  it("template, bundle, and validation are pure functions", () => {
    expect(buildForeverProjectTemplate()).toEqual(buildForeverProjectTemplate());
    const build = () => buildProjectBundle(makePackage());
    expect(build()).toEqual(build());
    const catalog = makeCatalog();
    expect(JSON.stringify(validateProjectCatalog(catalog))).toBe(
      JSON.stringify(validateProjectCatalog(catalog)),
    );
  });

  it("does not mutate the catalogue it validates or appends to", () => {
    const catalog = makeCatalog({ entries: [makeEntry(), makeEntry({ enabled: true })] });
    const snapshot = structuredClone(catalog);
    validateProjectCatalog(catalog);
    addProjectCatalogEntry(catalog, makeEntry({ enabled: true }));
    expect(catalog).toEqual(snapshot);
  });

  it("does not mutate the package a bundle is built from", () => {
    const pkg = makePackage();
    const snapshot = structuredClone(pkg);
    buildProjectBundle(pkg);
    expect(pkg).toEqual(snapshot);
  });
});
