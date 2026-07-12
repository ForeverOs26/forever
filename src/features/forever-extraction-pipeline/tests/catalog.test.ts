import { describe, expect, it } from "vitest";

import {
  addExtractionCatalogEntry,
  emptyExtractionCatalog,
  findExtractionCatalogEntry,
  listEnabledExtractionCatalogEntries,
} from "..";
import { makeEntry } from "./fixtures";

describe("extraction catalogue", () => {
  it("starts empty and attaches the name only when supplied", () => {
    expect(emptyExtractionCatalog("forever-extractions")).toEqual({
      id: "forever-extractions",
      entries: [],
    });
    expect(emptyExtractionCatalog("forever-extractions", "Forever Extractions").name).toBe(
      "Forever Extractions",
    );
  });

  it("appends immutably", () => {
    const empty = emptyExtractionCatalog("forever-extractions");
    const one = addExtractionCatalogEntry(empty, makeEntry());
    expect(empty.entries).toHaveLength(0);
    expect(one.entries).toHaveLength(1);
  });

  it("finds entries by definition id and lists enabled entries in order", () => {
    const enabled = makeEntry();
    const disabled = makeEntry({ enabled: false });
    const catalog = addExtractionCatalogEntry(
      addExtractionCatalogEntry(emptyExtractionCatalog("c"), enabled),
      disabled,
    );
    expect(findExtractionCatalogEntry(catalog, "extr_forever-extraction")).toBe(catalog.entries[0]);
    expect(findExtractionCatalogEntry(catalog, "extr_missing")).toBeUndefined();
    expect(listEnabledExtractionCatalogEntries(catalog)).toEqual([catalog.entries[0]]);
  });
});
