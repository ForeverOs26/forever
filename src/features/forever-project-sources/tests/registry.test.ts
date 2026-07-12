import { describe, expect, it } from "vitest";

import { ProjectSourceRegistry, describeProjectSource, projectSourceVersion } from "..";
import { makeInput, makeSource } from "./fixtures";

const DOCUMENT_KEY = "proj_coralina:price-list";

describe("ProjectSourceRegistry", () => {
  it("registers, resolves, and lists in insertion order", () => {
    const registry = new ProjectSourceRegistry();
    const source = makeSource();
    registry.register(source);

    expect(registry.has(source.identity.id)).toBe(true);
    expect(registry.resolve(source.identity.id)).toBe(source);
    expect(registry.resolve("psrc_unknown")).toBeUndefined();
    expect(registry.list()).toEqual([source]);
  });

  it("throws on a duplicate id so a clash is caught at wiring time", () => {
    const registry = new ProjectSourceRegistry().register(makeSource());
    expect(() => registry.register(makeSource())).toThrow(/already registered/);
  });

  it("filters by project, document type, and status", () => {
    const priceList = makeSource();
    const brochure = describeProjectSource(
      makeInput({ sourceSlug: "brochure", documentType: "brochure", status: "verified" }),
    );
    const foreign = describeProjectSource(makeInput({ projectSlug: "modeva" }));
    const registry = new ProjectSourceRegistry()
      .register(priceList)
      .register(brochure)
      .register(foreign);

    expect(registry.listByProject("proj_coralina")).toEqual([priceList, brochure]);
    expect(registry.listByDocumentType("brochure")).toEqual([brochure]);
    expect(registry.listByStatus("verified")).toEqual([brochure]);
  });

  it("orders every revision of a document and resolves the latest, without storage", () => {
    const v2 = describeProjectSource(makeInput({ version: projectSourceVersion(2, 0, 0) }));
    const v1 = makeSource({ status: "superseded" });
    const registry = new ProjectSourceRegistry().register(v2).register(v1);

    expect(registry.versionsOf(DOCUMENT_KEY)).toEqual([v1, v2]);
    expect(registry.latestVersionOf(DOCUMENT_KEY)).toBe(v2);
    expect(registry.versionsOf("proj_coralina:missing")).toEqual([]);
    expect(registry.latestVersionOf("proj_coralina:missing")).toBeUndefined();
  });
});
