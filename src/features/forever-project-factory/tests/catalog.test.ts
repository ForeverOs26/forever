import { describe, expect, it } from "vitest";

import {
  FOREVER_PROJECT_FACTORY_ID,
  addFactoryCatalogEntry,
  emptyFactoryCatalog,
  findFactoryCatalogEntry,
  listEnabledFactoryCatalogEntries,
} from "..";
import { makeCatalog, makeEntry } from "./fixtures";

describe("factory catalogue", () => {
  it("builds an empty catalogue (name only when supplied) and appends immutably", () => {
    expect(emptyFactoryCatalog("factories")).toEqual({ id: "factories", entries: [] });
    expect(emptyFactoryCatalog("factories", "Factories")).toEqual({
      id: "factories",
      name: "Factories",
      entries: [],
    });

    const catalog = emptyFactoryCatalog("factories");
    const grown = addFactoryCatalogEntry(catalog, makeEntry());
    expect(catalog.entries).toEqual([]);
    expect(grown.entries).toHaveLength(1);
  });

  it("finds an entry by its factory id", () => {
    const catalog = makeCatalog();
    expect(findFactoryCatalogEntry(catalog, FOREVER_PROJECT_FACTORY_ID)?.enabled).toBe(false);
    expect(findFactoryCatalogEntry(catalog, "fact_unknown")).toBeUndefined();
  });

  it("lists only the enabled entries, in catalogue order", () => {
    const catalog = makeCatalog({
      entries: [makeEntry(), makeEntry({ enabled: true, notes: "on" })],
    });
    const enabled = listEnabledFactoryCatalogEntries(catalog);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].notes).toBe("on");
  });
});
