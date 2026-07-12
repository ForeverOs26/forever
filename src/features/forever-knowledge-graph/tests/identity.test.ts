import { describe, expect, it } from "vitest";

import {
  normalizeProjectDatabaseSlug,
  projectDatabaseProjectId,
} from "@/features/forever-project-database";

import {
  KNOWLEDGE_GRAPH_ID_PREFIXES,
  knowledgeEdgeIdFor,
  knowledgeGraphIdFor,
  knowledgeNodeIdFor,
  knowledgeProjectId,
  normalizeKnowledgeSlug,
} from "..";

describe("knowledge-graph identity", () => {
  it("reuses the RC4.6 slug rule and RC4.2 proj_ convention — the same functions", () => {
    expect(normalizeKnowledgeSlug).toBe(normalizeProjectDatabaseSlug);
    expect(knowledgeProjectId).toBe(projectDatabaseProjectId);
  });

  it("declares the kgr_/kgn_/kge_ prefix conventions", () => {
    expect(KNOWLEDGE_GRAPH_ID_PREFIXES).toEqual({ graph: "kgr_", node: "kgn_", edge: "kge_" });
  });

  it("derives graph ids from the project and the caller-stated batch only", () => {
    expect(knowledgeGraphIdFor("Coralina")).toBe("kgr_coralina");
    expect(knowledgeGraphIdFor("coralina", "2026-07")).toBe("kgr_coralina-2026-07");
    expect(knowledgeGraphIdFor("coralina")).not.toContain("undefined");
  });

  it("derives node ids from the project, kind, and canonical key", () => {
    expect(knowledgeNodeIdFor("coralina", "source", "psrc_coralina-price-list-v1-0-0")).toBe(
      "kgn_coralina-source-psrc-coralina-price-list-v1-0-0",
    );
    expect(knowledgeNodeIdFor("coralina", "claim", "proj_coralina:price:pricing.basePrice#1")).toBe(
      "kgn_coralina-claim-proj-coralina-price-pricing-baseprice-1",
    );
  });

  it("derives edge ids from the project, kind, and deterministic ordinal", () => {
    expect(knowledgeEdgeIdFor("coralina", "describes", 1)).toBe("kge_coralina-describes-1");
    expect(knowledgeEdgeIdFor("coralina", "conflicts_with", 3)).toBe(
      "kge_coralina-conflicts-with-3",
    );
  });

  it("id derivation is pure: identical input, identical id", () => {
    expect(knowledgeGraphIdFor("coralina", "b")).toBe(knowledgeGraphIdFor("coralina", "b"));
    expect(knowledgeNodeIdFor("a", "fact", "x")).toBe(knowledgeNodeIdFor("a", "fact", "x"));
    expect(knowledgeEdgeIdFor("a", "states", 2)).toBe(knowledgeEdgeIdFor("a", "states", 2));
  });
});
