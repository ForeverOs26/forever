import { describe, expect, it } from "vitest";

import {
  DECLARABLE_KNOWLEDGE_EDGE_KINDS,
  KNOWLEDGE_EDGE_ENDPOINTS,
  KNOWLEDGE_EDGE_KINDS,
  KNOWLEDGE_EDGE_ORIGINS,
  compareKnowledgeEdges,
  isDeclarableKnowledgeEdgeKind,
  isKnownKnowledgeEdgeKind,
  isKnownKnowledgeEdgeOrigin,
  knowledgeEdge,
  knowledgeEdgeKindRank,
  sortKnowledgeEdges,
} from "..";

describe("knowledge edge", () => {
  it("declares the closed kind vocabulary and endpoint grammar together", () => {
    expect(KNOWLEDGE_EDGE_KINDS).toHaveLength(18);
    for (const kind of KNOWLEDGE_EDGE_KINDS) {
      expect(isKnownKnowledgeEdgeKind(kind)).toBe(true);
      const endpoints = KNOWLEDGE_EDGE_ENDPOINTS[kind];
      expect(endpoints.from.length).toBeGreaterThan(0);
      expect(endpoints.to.length).toBeGreaterThan(0);
    }
    expect(isKnownKnowledgeEdgeKind("causes")).toBe(false);
  });

  it("only the entity-facing domain kinds are declarable", () => {
    expect(DECLARABLE_KNOWLEDGE_EDGE_KINDS).toEqual([
      "developed_by",
      "located_in",
      "near",
      "contains",
      "offers",
      "refers_to",
    ]);
    for (const kind of DECLARABLE_KNOWLEDGE_EDGE_KINDS) {
      expect(isDeclarableKnowledgeEdgeKind(kind)).toBe(true);
    }
    expect(isDeclarableKnowledgeEdgeKind("supports")).toBe(false);
    expect(isDeclarableKnowledgeEdgeKind("affects")).toBe(false);
  });

  it("declares the two origins — an edge is never guessed into being", () => {
    expect(KNOWLEDGE_EDGE_ORIGINS).toEqual(["derived", "declared"]);
    expect(isKnownKnowledgeEdgeOrigin("derived")).toBe(true);
    expect(isKnownKnowledgeEdgeOrigin("guessed")).toBe(false);
  });

  it("ranks out-of-vocabulary kinds after everything", () => {
    expect(knowledgeEdgeKindRank("describes")).toBe(0);
    expect(knowledgeEdgeKindRank("nonsense" as never)).toBe(KNOWLEDGE_EDGE_KINDS.length);
  });

  it("builds edges without fabricating absent facts, and never aliases refs", () => {
    const refs = [{ factId: "xfact_x" }];
    const edge = knowledgeEdge(
      "kge_1",
      "states",
      "kgn_a",
      "kgn_b",
      "proj_x",
      "derived",
      "unverified",
      {
        refs,
      },
    );
    expect(edge.refs).toEqual(refs);
    expect(edge.refs).not.toBe(refs);
    expect(Object.keys(edge)).not.toContain("confidence");
    expect(Object.keys(edge)).not.toContain("note");
  });

  it("sorts by kind rank, endpoints, first reference, then id — stably and immutably", () => {
    const a = knowledgeEdge(
      "kge_2",
      "states",
      "kgn_a",
      "kgn_b",
      "proj_x",
      "derived",
      "unverified",
      {
        refs: [{ factId: "a" }],
      },
    );
    const b = knowledgeEdge(
      "kge_1",
      "describes",
      "kgn_s",
      "kgn_p",
      "proj_x",
      "derived",
      "unverified",
      {
        refs: [{ sourceId: "s" }],
      },
    );
    const c = knowledgeEdge(
      "kge_3",
      "states",
      "kgn_a",
      "kgn_b",
      "proj_x",
      "derived",
      "unverified",
      {
        refs: [{ factId: "b" }],
      },
    );
    const edges = [a, c, b];
    const snapshot = structuredClone(edges);
    const sorted = sortKnowledgeEdges(edges);
    expect(sorted.map((edge) => edge.id)).toEqual(["kge_1", "kge_2", "kge_3"]);
    expect(edges).toEqual(snapshot);
    expect(compareKnowledgeEdges(a, a)).toBe(0);
  });

  it("comparison is total over malformed edges", () => {
    const edge = knowledgeEdge("kge_1", "states", "a", "b", "p", "derived", "unverified");
    expect(() => sortKnowledgeEdges([null as never, edge])).not.toThrow();
  });
});
