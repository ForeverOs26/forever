import { describe, expect, it } from "vitest";

import {
  ConnectorDefinitionRegistry,
  addConnectorEntry,
  emptyConnectorRegistry,
  findConnectorEntry,
  listConnectorEntriesByStatus,
} from "..";
import { makeDefinition, makeEntry, makeRegistry } from "./fixtures";

describe("ConnectorDefinitionRegistry", () => {
  it("registers, resolves, and lists definitions in insertion order", () => {
    const website = makeDefinition();
    const crm = makeDefinition({
      identity: {
        id: "conn_crm",
        slug: "crm",
        name: "CRM",
        protocol: "http",
        targetSystem: "crm",
      },
    });
    const registry = new ConnectorDefinitionRegistry().register(website).register(crm);

    expect(registry.has("conn_developer_website")).toBe(true);
    expect(registry.resolve("conn_crm")).toBe(crm);
    expect(registry.list()).toEqual([website, crm]);
    expect(registry.listBySystem("crm")).toEqual([crm]);
    expect(registry.listByProtocol("http")).toEqual([website, crm]);
  });

  it("throws when the same id is registered twice", () => {
    const registry = new ConnectorDefinitionRegistry().register(makeDefinition());
    expect(() => registry.register(makeDefinition())).toThrow(/already registered/);
  });

  it("resolves an unknown id to undefined", () => {
    expect(new ConnectorDefinitionRegistry().resolve("conn_missing")).toBeUndefined();
  });
});

describe("registry data model", () => {
  it("builds an empty registry and appends immutably", () => {
    const empty = emptyConnectorRegistry("cat", "Catalogue");
    expect(empty).toEqual({ id: "cat", name: "Catalogue", entries: [] });

    const appended = addConnectorEntry(empty, makeEntry());
    expect(empty.entries).toHaveLength(0);
    expect(appended.entries).toHaveLength(1);
  });

  it("finds entries by connector id and filters by status", () => {
    const registry = makeRegistry({
      entries: [makeEntry(), makeEntry({ status: "ready" })],
    });
    expect(findConnectorEntry(registry, "conn_developer_website")).toBe(registry.entries[0]);
    expect(listConnectorEntriesByStatus(registry, "ready")).toHaveLength(1);
    expect(listConnectorEntriesByStatus(registry, "disabled")).toHaveLength(0);
  });
});
