import { describe, expect, it } from "vitest";

import {
  addProjectSourceCatalogEntry,
  emptyProjectSourceCatalog,
  findProjectSourceCatalogEntry,
  latestProjectSourceCatalogEntry,
  listEnabledProjectSourceCatalogEntries,
  listProjectSourceCatalogEntriesForProject,
  listProjectSourceCatalogVersions,
  projectSourceVersion,
} from "..";
import { makeCatalog, makeEntry, makeInput, makeSource } from "./fixtures";
import { describeProjectSource } from "../definition";

const DOCUMENT_KEY = "proj_coralina:price-list";

describe("source catalogue", () => {
  it("builds an empty catalogue (name only when supplied) and appends immutably", () => {
    expect(emptyProjectSourceCatalog("sources")).toEqual({ id: "sources", entries: [] });
    expect(emptyProjectSourceCatalog("sources", "Sources")).toEqual({
      id: "sources",
      name: "Sources",
      entries: [],
    });

    const catalog = emptyProjectSourceCatalog("sources");
    const grown = addProjectSourceCatalogEntry(catalog, makeEntry());
    expect(catalog.entries).toEqual([]);
    expect(grown.entries).toHaveLength(1);
  });

  it("finds an entry by its source id and filters by project and enabled flag", () => {
    const foreign = makeEntry({
      definition: describeProjectSource(makeInput({ projectSlug: "modeva" })),
      enabled: false,
    });
    const catalog = makeCatalog({ entries: [makeEntry(), foreign] });

    expect(findProjectSourceCatalogEntry(catalog, "psrc_coralina-price-list-v1-0-0")?.enabled).toBe(
      true,
    );
    expect(findProjectSourceCatalogEntry(catalog, "psrc_unknown")).toBeUndefined();

    expect(listEnabledProjectSourceCatalogEntries(catalog)).toHaveLength(1);
    expect(listProjectSourceCatalogEntriesForProject(catalog, "proj_modeva")).toEqual([foreign]);
  });
});

describe("document versions in a catalogue", () => {
  const v1 = makeEntry({
    definition: makeSource({ status: "superseded" }),
    enabled: false,
  });
  const v2 = makeEntry({
    definition: describeProjectSource(makeInput({ version: projectSourceVersion(2, 0, 0) })),
  });
  const other = makeEntry({
    definition: describeProjectSource(
      makeInput({ sourceSlug: "brochure", documentType: "brochure" }),
    ),
  });

  it("lists every revision of one document oldest first, without storage", () => {
    const catalog = makeCatalog({ entries: [v2, other, v1] });
    const versions = listProjectSourceCatalogVersions(catalog, DOCUMENT_KEY);
    expect(versions).toEqual([v1, v2]);
  });

  it("resolves the latest revision, or undefined for an unknown document", () => {
    const catalog = makeCatalog({ entries: [v2, other, v1] });
    expect(latestProjectSourceCatalogEntry(catalog, DOCUMENT_KEY)).toBe(v2);
    expect(latestProjectSourceCatalogEntry(catalog, "proj_coralina:missing")).toBeUndefined();
  });

  it("keeps catalogue order for equal revisions (stable) and never mutates the catalogue", () => {
    const twinA = makeEntry({ notes: "first" });
    const twinB = makeEntry({ notes: "second" });
    const catalog = makeCatalog({ entries: [twinA, twinB] });
    const snapshot = structuredClone(catalog);
    expect(listProjectSourceCatalogVersions(catalog, DOCUMENT_KEY)).toEqual([twinA, twinB]);
    expect(catalog).toEqual(snapshot);
  });
});
