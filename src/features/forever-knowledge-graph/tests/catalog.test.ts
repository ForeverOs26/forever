import { describe, expect, it } from "vitest";

import {
  addKnowledgeGraphCatalogEntry,
  emptyKnowledgeGraphCatalog,
  findKnowledgeGraphCatalogEntry,
  listEnabledKnowledgeGraphCatalogEntries,
  listKnowledgeGraphCatalogEntriesForProject,
  validateKnowledgeGraphCatalog,
} from "..";
import { NOW, makeGraph, runGraph } from "./fixtures";

describe("knowledge-graph catalogue", () => {
  it("builds an empty catalogue without fabricating a name", () => {
    expect(emptyKnowledgeGraphCatalog("main")).toEqual({ id: "main", entries: [] });
    expect(emptyKnowledgeGraphCatalog("main", "Main")).toEqual({
      id: "main",
      name: "Main",
      entries: [],
    });
  });

  it("appends immutably and finds by graph id", () => {
    const catalog = emptyKnowledgeGraphCatalog("main");
    const graph = makeGraph();
    const grown = addKnowledgeGraphCatalogEntry(catalog, {
      graph,
      enabled: true,
      registeredAt: NOW,
    });
    expect(catalog.entries).toHaveLength(0);
    expect(grown.entries).toHaveLength(1);
    expect(findKnowledgeGraphCatalogEntry(grown, graph.id)?.graph).toBe(graph);
    expect(findKnowledgeGraphCatalogEntry(grown, "kgr_unknown")).toBeUndefined();
  });

  it("lists enabled entries and entries per project in catalogue order", () => {
    const disabled = runGraph({}, { batch: "old" }).data[0];
    const catalog = addKnowledgeGraphCatalogEntry(
      addKnowledgeGraphCatalogEntry(emptyKnowledgeGraphCatalog("main"), {
        graph: makeGraph(),
        enabled: true,
      }),
      { graph: disabled, enabled: false },
    );
    expect(listEnabledKnowledgeGraphCatalogEntries(catalog)).toHaveLength(1);
    expect(listKnowledgeGraphCatalogEntriesForProject(catalog, "proj_coralina")).toHaveLength(2);
    expect(listKnowledgeGraphCatalogEntriesForProject(catalog, "proj_other")).toHaveLength(0);
  });

  it("validates a coherent catalogue cleanly and flags incoherent entries", () => {
    const clean = addKnowledgeGraphCatalogEntry(emptyKnowledgeGraphCatalog("main"), {
      graph: makeGraph(),
      enabled: true,
      registeredAt: NOW,
      notes: "First described graph.",
    });
    expect(validateKnowledgeGraphCatalog(clean)).toEqual([]);

    const duplicated = addKnowledgeGraphCatalogEntry(clean, {
      graph: makeGraph(),
      enabled: "yes" as never,
      registeredAt: "",
      notes: "",
    });
    const codes = validateKnowledgeGraphCatalog(duplicated).map((issue) => issue.code);
    expect(codes).toContain("duplicate_graph_id");
    expect(codes).toContain("invalid_entry_enabled");
    expect(codes).toContain("empty_entry_time");
    expect(codes).toContain("empty_entry_notes");
  });
});
