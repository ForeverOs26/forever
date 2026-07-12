import { describe, expect, it } from "vitest";

import { KnowledgeGraphRegistry } from "..";
import { makeContestedGraph, makeGraph, runGraph } from "./fixtures";

describe("KnowledgeGraphRegistry", () => {
  it("registers and resolves graphs by graph id", () => {
    const registry = new KnowledgeGraphRegistry();
    const graph = makeGraph();
    registry.register(graph);
    expect(registry.has(graph.id)).toBe(true);
    expect(registry.resolve(graph.id)).toBe(graph);
    expect(registry.resolve("kgr_unknown")).toBeUndefined();
    expect(registry.has("kgr_unknown")).toBe(false);
  });

  it("throws on re-registration — the wiring-time clash, the module's only throw", () => {
    const registry = new KnowledgeGraphRegistry();
    const graph = makeGraph();
    registry.register(graph);
    expect(() => registry.register(makeGraph())).toThrow(
      "A knowledge graph is already registered for kgr_coralina",
    );
  });

  it("keeps distinguishable runs apart through the caller-stated batch", () => {
    const registry = new KnowledgeGraphRegistry();
    registry.register(makeGraph());
    const batched = runGraph({}, { batch: "2026-07" }).data[0];
    registry.register(batched);
    expect(registry.list()).toHaveLength(2);
  });

  it("lists by project, node kind, and unresolved standing", () => {
    const registry = new KnowledgeGraphRegistry();
    const settled = makeGraph();
    const contested = makeContestedGraph();
    // Distinguish the ids so both register.
    registry.register(settled);
    registry.register({ ...contested, id: "kgr_coralina-contested" });
    expect(registry.listByProject("proj_coralina")).toHaveLength(2);
    expect(registry.listByProject("proj_other")).toHaveLength(0);
    expect(registry.listByNodeKind("claim")).toHaveLength(2);
    expect(registry.listByNodeKind("developer")).toHaveLength(0);
    const requiring = registry.listRequiringReview();
    expect(requiring).toHaveLength(1);
    expect(requiring[0].id).toBe("kgr_coralina-contested");
  });
});
