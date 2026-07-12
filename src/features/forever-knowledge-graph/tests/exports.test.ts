import { describe, expect, it } from "vitest";

import * as KnowledgeGraph from "..";

describe("public API surface", () => {
  it("exposes the minimal coherent foundation surface", () => {
    // Identity.
    expect(KnowledgeGraph.KNOWLEDGE_GRAPH_ID_PREFIXES).toBeDefined();
    expect(typeof KnowledgeGraph.knowledgeGraphIdFor).toBe("function");
    expect(typeof KnowledgeGraph.knowledgeNodeIdFor).toBe("function");
    expect(typeof KnowledgeGraph.knowledgeEdgeIdFor).toBe("function");
    // Vocabulary.
    expect(KnowledgeGraph.KNOWLEDGE_NODE_KINDS).toBeDefined();
    expect(KnowledgeGraph.KNOWLEDGE_ENTITY_KINDS).toBeDefined();
    expect(KnowledgeGraph.KNOWLEDGE_EDGE_KINDS).toBeDefined();
    expect(KnowledgeGraph.KNOWLEDGE_EDGE_ENDPOINTS).toBeDefined();
    expect(KnowledgeGraph.DECLARABLE_KNOWLEDGE_EDGE_KINDS).toBeDefined();
    expect(KnowledgeGraph.KNOWLEDGE_STANDINGS).toBeDefined();
    // Builders and the engine.
    expect(typeof KnowledgeGraph.knowledgeNode).toBe("function");
    expect(typeof KnowledgeGraph.knowledgeEdge).toBe("function");
    expect(typeof KnowledgeGraph.describeKnowledgeGraph).toBe("function");
    // Queries.
    expect(typeof KnowledgeGraph.findKnowledgeNode).toBe("function");
    expect(typeof KnowledgeGraph.listKnowledgeClaims).toBe("function");
    expect(typeof KnowledgeGraph.knowledgeGraphRequiresReview).toBe("function");
    // Result, history, catalogue, registry, contract.
    expect(typeof KnowledgeGraph.createKnowledgeGraphResult).toBe("function");
    expect(typeof KnowledgeGraph.knowledgeGraphHistoryEntry).toBe("function");
    expect(typeof KnowledgeGraph.emptyKnowledgeGraphCatalog).toBe("function");
    expect(KnowledgeGraph.KnowledgeGraphRegistry).toBeDefined();
    expect(typeof KnowledgeGraph.defineKnowledgeGraphProvider).toBe("function");
    // Validation never throws — the whole pipeline is exported.
    expect(typeof KnowledgeGraph.validateKnowledgeGraph).toBe("function");
    expect(typeof KnowledgeGraph.validateKnowledgeNode).toBe("function");
    expect(typeof KnowledgeGraph.validateKnowledgeEdge).toBe("function");
    expect(typeof KnowledgeGraph.validateKnowledgeRef).toBe("function");
    expect(typeof KnowledgeGraph.validateKnowledgeGraphCatalog).toBe("function");
    expect(typeof KnowledgeGraph.validateKnowledgeGraphHistory).toBe("function");
  });

  it("exposes the reused helpers under knowledge-graph names", () => {
    expect(typeof KnowledgeGraph.isAbsent).toBe("function");
    expect(typeof KnowledgeGraph.isNonEmptyString).toBe("function");
    expect(typeof KnowledgeGraph.compareKnowledgeStrings).toBe("function");
    expect(typeof KnowledgeGraph.normalizeKnowledgeSlug).toBe("function");
    expect(typeof KnowledgeGraph.knowledgeProjectId).toBe("function");
    expect(typeof KnowledgeGraph.knowledgeStandingForConsensus).toBe("function");
  });
});
