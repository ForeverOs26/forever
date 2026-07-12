import { describe, expect, it } from "vitest";

import {
  addProjectDatabaseCatalogEntry,
  emptyProjectDatabaseCatalog,
  findProjectDatabaseCatalogEntry,
  listEnabledProjectDatabaseCatalogEntries,
} from "..";
import { makeCatalog, makeEntry, makeRecord } from "./fixtures";

describe("catalogue data model", () => {
  it("starts empty, with the name attached only when supplied", () => {
    expect(emptyProjectDatabaseCatalog("forever-projects")).toEqual({
      id: "forever-projects",
      entries: [],
    });
    expect(emptyProjectDatabaseCatalog("forever-projects", "Forever").name).toBe("Forever");
  });

  it("appends entries immutably", () => {
    const catalog = makeCatalog();
    const snapshot = structuredClone(catalog);
    const other = makeEntry({
      record: makeRecord({
        identity: { ...makeRecord().identity, projectId: "proj_other", slug: "other" },
      }),
    });
    const grown = addProjectDatabaseCatalogEntry(catalog, other);
    expect(catalog).toEqual(snapshot);
    expect(grown.entries).toHaveLength(2);
    expect(grown.entries[0]).toBe(catalog.entries[0]);
  });

  it("finds the entry canonicalizing a project", () => {
    const catalog = makeCatalog();
    expect(findProjectDatabaseCatalogEntry(catalog, "proj_coralina")?.record.identity.slug).toBe(
      "coralina",
    );
    expect(findProjectDatabaseCatalogEntry(catalog, "proj_missing")).toBeUndefined();
  });

  it("lists only enabled entries, in catalogue order", () => {
    const disabled = makeEntry({ enabled: false });
    const catalog = makeCatalog({ entries: [makeEntry(), disabled] });
    const enabled = listEnabledProjectDatabaseCatalogEntries(catalog);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].enabled).toBe(true);
  });
});
