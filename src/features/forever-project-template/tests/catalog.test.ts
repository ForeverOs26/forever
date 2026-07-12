import { describe, expect, it } from "vitest";

import {
  addProjectCatalogEntry,
  emptyProjectCatalog,
  findProjectCatalogEntry,
  listEnabledProjectCatalogEntries,
} from "..";
import { makeEntry } from "./fixtures";

describe("project catalogue data model", () => {
  it("builds an empty catalogue with an optional name", () => {
    expect(emptyProjectCatalog("c1")).toEqual({ id: "c1", entries: [] });
    expect(emptyProjectCatalog("c1", "Catalogue")).toEqual({
      id: "c1",
      name: "Catalogue",
      entries: [],
    });
  });

  it("appends an entry immutably", () => {
    const empty = emptyProjectCatalog("c1");
    const next = addProjectCatalogEntry(empty, makeEntry({ enabled: true }));
    expect(empty.entries).toHaveLength(0);
    expect(next.entries).toHaveLength(1);
    expect(next).not.toBe(empty);
  });

  it("finds an entry by package id", () => {
    const catalog = addProjectCatalogEntry(emptyProjectCatalog("c1"), makeEntry());
    expect(findProjectCatalogEntry(catalog, "pkg_coralina")?.package.identity.slug).toBe(
      "coralina",
    );
    expect(findProjectCatalogEntry(catalog, "pkg_absent")).toBeUndefined();
  });

  it("lists only enabled entries", () => {
    let catalog = emptyProjectCatalog("c1");
    catalog = addProjectCatalogEntry(catalog, makeEntry({ enabled: false }));
    catalog = addProjectCatalogEntry(catalog, makeEntry({ enabled: true }));
    expect(listEnabledProjectCatalogEntries(catalog)).toHaveLength(1);
  });
});
