import { describe, expect, it } from "vitest";

import {
  SourceDefinitionRegistry,
  addSourceEntry,
  emptySourceRegistry,
  findSourceEntry,
  listSourceEntriesByStatus,
} from "..";
import { makeDefinition, makeEntry } from "./fixtures";

describe("SourceDefinitionRegistry", () => {
  it("registers, resolves, and lists definitions by id", () => {
    const registry = new SourceDefinitionRegistry();
    const definition = makeDefinition();
    registry.register(definition);
    expect(registry.has("src_developer_website")).toBe(true);
    expect(registry.resolve("src_developer_website")).toBe(definition);
    expect(registry.resolve("missing")).toBeUndefined();
    expect(registry.list()).toEqual([definition]);
  });

  it("rejects a second definition for the same id", () => {
    const registry = new SourceDefinitionRegistry();
    registry.register(makeDefinition());
    expect(() => registry.register(makeDefinition())).toThrow(/already registered/);
  });

  it("lists definitions by type", () => {
    const registry = new SourceDefinitionRegistry();
    const website = makeDefinition();
    const crm = makeDefinition({
      identity: {
        id: "src_crm",
        slug: "crm",
        name: "CRM",
        type: "crm",
        category: "crm",
      },
    });
    registry.register(website).register(crm);
    expect(registry.listByType("crm")).toEqual([crm]);
    expect(registry.listByType("developer_website")).toEqual([website]);
  });
});

describe("source registry model helpers", () => {
  it("appends entries immutably", () => {
    const empty = emptySourceRegistry("catalog");
    const entry = makeEntry();
    const next = addSourceEntry(empty, entry);
    expect(empty.entries).toEqual([]);
    expect(next.entries).toEqual([entry]);
    expect(next).not.toBe(empty);
  });

  it("finds an entry by source id and filters by status", () => {
    const registry = {
      id: "catalog",
      entries: [
        makeEntry({ status: "enabled" }),
        makeEntry({
          definition: makeDefinition({
            identity: {
              id: "src_pdf",
              slug: "pdf",
              name: "PDF",
              type: "pdf",
              category: "file",
            },
          }),
          status: "draft",
        }),
      ],
    };
    expect(findSourceEntry(registry, "src_pdf")?.definition.identity.type).toBe("pdf");
    expect(findSourceEntry(registry, "missing")).toBeUndefined();
    expect(listSourceEntriesByStatus(registry, "enabled")).toHaveLength(1);
  });
});
