import { describe, expect, it } from "vitest";

import {
  KnowledgeGraphRegistry,
  defineKnowledgeGraphProvider,
  knowledgeGraphProviderEdgeCount,
  knowledgeGraphProviderNodeCount,
  knowledgeGraphProviderProjectId,
  knowledgeGraphProviderRequiresReview,
} from "..";
import { makeContestedGraph, makeGraph } from "./fixtures";

describe("knowledge-graph provider contract", () => {
  it("pins a provider without changing it", () => {
    const provider = defineKnowledgeGraphProvider({ graph: makeGraph() });
    expect(provider.graph.id).toBe("kgr_coralina");
  });

  it("answers the descriptor questions from the graph alone", () => {
    const settled = defineKnowledgeGraphProvider({ graph: makeGraph() });
    expect(knowledgeGraphProviderProjectId(settled)).toBe("proj_coralina");
    expect(knowledgeGraphProviderNodeCount(settled)).toBe(settled.graph.nodes.length);
    expect(knowledgeGraphProviderEdgeCount(settled)).toBe(settled.graph.edges.length);
    expect(knowledgeGraphProviderRequiresReview(settled)).toBe(false);

    const contested = defineKnowledgeGraphProvider({ graph: makeContestedGraph() });
    expect(knowledgeGraphProviderRequiresReview(contested)).toBe(true);
  });

  it("plugs into the registry without any existing code changing", () => {
    const provider = defineKnowledgeGraphProvider({ graph: makeGraph() });
    const registry = new KnowledgeGraphRegistry().register(provider.graph);
    expect(registry.resolve(provider.graph.id)).toBe(provider.graph);
  });
});
