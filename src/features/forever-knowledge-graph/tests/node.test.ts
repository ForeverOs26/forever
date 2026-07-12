import { describe, expect, it } from "vitest";

import {
  KNOWLEDGE_ENTITY_KINDS,
  KNOWLEDGE_NODE_KINDS,
  compareKnowledgeNodes,
  isKnownKnowledgeEntityKind,
  isKnownKnowledgeNodeKind,
  knowledgeNode,
  knowledgeNodeKindRank,
  sortKnowledgeNodes,
} from "..";
import type { KnowledgeNode } from "..";

describe("knowledge node", () => {
  it("declares the closed kind vocabulary with the entity kinds inside it", () => {
    expect(KNOWLEDGE_NODE_KINDS).toHaveLength(13);
    for (const kind of KNOWLEDGE_ENTITY_KINDS) {
      expect(KNOWLEDGE_NODE_KINDS).toContain(kind);
      expect(isKnownKnowledgeEntityKind(kind)).toBe(true);
    }
    expect(isKnownKnowledgeNodeKind("project")).toBe(true);
    expect(isKnownKnowledgeNodeKind("claim")).toBe(true);
    expect(isKnownKnowledgeNodeKind("universe")).toBe(false);
    expect(isKnownKnowledgeEntityKind("project")).toBe(false);
  });

  it("ranks out-of-vocabulary kinds after everything", () => {
    expect(knowledgeNodeKindRank("project")).toBe(0);
    expect(knowledgeNodeKindRank("nonsense" as never)).toBe(KNOWLEDGE_NODE_KINDS.length);
  });

  it("builds nodes without fabricating absent facts", () => {
    const bare = knowledgeNode("kgn_x", "fact", "xfact_x", "proj_x");
    expect(bare).toEqual({
      id: "kgn_x",
      kind: "fact",
      key: "xfact_x",
      projectId: "proj_x",
      refs: [],
    });
    expect(Object.keys(bare)).not.toContain("label");
    expect(Object.keys(bare)).not.toContain("standing");
  });

  it("never aliases the caller's refs", () => {
    const refs = [{ factId: "xfact_x" }];
    const node = knowledgeNode("kgn_x", "fact", "xfact_x", "proj_x", { refs });
    expect(node.refs).toEqual(refs);
    expect(node.refs).not.toBe(refs);
    node.refs.push({ factId: "other" });
    expect(refs).toHaveLength(1);
  });

  it("sorts by kind rank, then key, then id — stably and immutably", () => {
    const nodes: KnowledgeNode[] = [
      knowledgeNode("kgn_3", "fact", "b", "proj_x", { refs: [{ factId: "b" }] }),
      knowledgeNode("kgn_2", "fact", "a", "proj_x", { refs: [{ factId: "a" }] }),
      knowledgeNode("kgn_1", "project", "x", "proj_x", { refs: [{ projectId: "proj_x" }] }),
    ];
    const snapshot = structuredClone(nodes);
    const sorted = sortKnowledgeNodes(nodes);
    expect(sorted.map((node) => node.id)).toEqual(["kgn_1", "kgn_2", "kgn_3"]);
    expect(nodes).toEqual(snapshot);
    expect(compareKnowledgeNodes(sorted[0], sorted[0])).toBe(0);
  });

  it("comparison is total over malformed nodes", () => {
    expect(() =>
      sortKnowledgeNodes([null as never, knowledgeNode("kgn_1", "fact", "a", "proj_x")]),
    ).not.toThrow();
  });
});
