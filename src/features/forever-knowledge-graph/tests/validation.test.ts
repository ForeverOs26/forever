import { describe, expect, it } from "vitest";

import {
  knowledgeEdge,
  knowledgeNode,
  validateKnowledgeEdge,
  validateKnowledgeEntityDeclaration,
  validateKnowledgeGraph,
  validateKnowledgeNode,
  validateKnowledgeRef,
  validateKnowledgeRelationDeclaration,
} from "..";
import { makeEntity, makeGraph, makeRelation } from "./fixtures";

const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe("reference validation", () => {
  it("accepts an anchored, coherent reference", () => {
    expect(validateKnowledgeRef({ factId: "xfact_x", path: "pricing.basePrice" })).toEqual([]);
  });

  it("flags empty parts, malformed pins, and unanchored references", () => {
    expect(codes(validateKnowledgeRef({ factId: "" }))).toContain("empty_ref_part");
    expect(
      codes(validateKnowledgeRef({ sourceId: "s", sourceVersion: { major: NaN } as never })),
    ).toContain("invalid_ref_version");
    expect(codes(validateKnowledgeRef({}))).toContain("unanchored_ref");
    expect(
      codes(validateKnowledgeRef({ sourceVersion: { major: 1, minor: 0, patch: 0 } })),
    ).toContain("unanchored_ref");
  });
});

describe("node validation", () => {
  it("accepts every node of a described graph", () => {
    for (const node of makeGraph().nodes) {
      expect(validateKnowledgeNode(node)).toEqual([]);
    }
  });

  it("flags missing identity parts and unknown vocabulary", () => {
    const issues = validateKnowledgeNode({
      id: "",
      kind: "galaxy" as never,
      key: "",
      projectId: "",
      refs: [],
    });
    expect(codes(issues)).toEqual(
      expect.arrayContaining([
        "missing_node_id",
        "unknown_node_kind",
        "missing_node_key",
        "missing_node_project",
        "untraceable_node",
      ]),
    );
  });

  it("flags claim-only facts on identities — certainty on an identity is fabrication", () => {
    const issues = validateKnowledgeNode(
      knowledgeNode("kgn_x", "source", "psrc_x", "proj_x", {
        refs: [{ sourceId: "psrc_x" }],
        standing: "corroborated",
        signature: "{}",
        subjectKey: "proj_x:price",
      }),
    );
    expect(codes(issues).filter((code) => code === "misplaced_claim_fact")).toHaveLength(3);
  });

  it("flags a claim without a subject or standing", () => {
    const issues = validateKnowledgeNode(
      knowledgeNode("kgn_x", "claim", "k", "proj_x", { refs: [{ subjectKey: "k" }] }),
    );
    expect(codes(issues)).toEqual(
      expect.arrayContaining(["claim_without_subject", "claim_without_standing"]),
    );
  });

  it("flags an untraceable node — the traceability mandate", () => {
    const issues = validateKnowledgeNode(knowledgeNode("kgn_x", "fact", "xfact_x", "proj_x"));
    expect(codes(issues)).toContain("untraceable_node");
  });
});

describe("edge validation", () => {
  const edge = (overrides: Partial<Parameters<typeof validateKnowledgeEdge>[0]> = {}) => ({
    ...knowledgeEdge("kge_1", "states", "kgn_a", "kgn_b", "proj_x", "derived", "unverified", {
      refs: [{ factId: "xfact_x" }],
    }),
    ...overrides,
  });

  it("accepts every edge of a described graph", () => {
    for (const described of makeGraph().edges) {
      expect(validateKnowledgeEdge(described)).toEqual([]);
    }
  });

  it("flags an understated conflict — a disagreement is never milder than itself", () => {
    const issues = validateKnowledgeEdge(edge({ kind: "conflicts_with", standing: "unverified" }));
    expect(codes(issues)).toContain("understated_conflict");
    expect(
      codes(validateKnowledgeEdge(edge({ kind: "contradicts", standing: "corroborated" }))),
    ).toContain("understated_conflict");
  });

  it("flags a derived domain edge — deriving it would be identity resolution", () => {
    const issues = validateKnowledgeEdge(edge({ kind: "developed_by", origin: "derived" }));
    expect(codes(issues)).toContain("underivable_edge");
  });

  it("flags a declared artifact edge — artifacts state their own relationships", () => {
    const issues = validateKnowledgeEdge(edge({ origin: "declared" }));
    expect(codes(issues)).toContain("undeclarable_edge");
  });

  it("flags an incoherent confidence through the reused RC4.5 guard", () => {
    const issues = validateKnowledgeEdge(
      edge({ confidence: { level: "unknown", score: 0.5 } as never }),
    );
    expect(codes(issues)).toContain("score_on_unknown_confidence");
  });

  it("flags an untraceable edge — the traceability mandate", () => {
    const issues = validateKnowledgeEdge(
      knowledgeEdge("kge_1", "states", "kgn_a", "kgn_b", "proj_x", "derived", "unverified"),
    );
    expect(codes(issues)).toContain("untraceable_edge");
  });
});

describe("declaration validation", () => {
  it("accepts the grounded fixtures", () => {
    expect(validateKnowledgeEntityDeclaration(makeEntity())).toEqual([]);
    expect(validateKnowledgeRelationDeclaration(makeRelation())).toEqual([]);
  });

  it("flags ungrounded and incoherent declarations", () => {
    expect(codes(validateKnowledgeEntityDeclaration(makeEntity({ refs: [] })))).toContain(
      "ungrounded_declaration",
    );
    expect(
      codes(validateKnowledgeEntityDeclaration(makeEntity({ kind: "spaceship" as never }))),
    ).toContain("unknown_entity_kind");
    expect(
      codes(validateKnowledgeRelationDeclaration(makeRelation({ kind: "states" as never }))),
    ).toContain("undeclarable_relation");
    expect(
      codes(
        validateKnowledgeRelationDeclaration(
          makeRelation({ from: { kind: "meteor" as never, key: "" } }),
        ),
      ),
    ).toEqual(expect.arrayContaining(["unknown_endpoint_kind", "missing_endpoint_key"]));
  });
});

describe("graph validation", () => {
  it("flags dangling edges, duplicates, and grammar violations", () => {
    const graph = makeGraph();
    const project = graph.nodes.find((node) => node.kind === "project")!;
    const source = graph.nodes.find((node) => node.kind === "source")!;
    const tampered = {
      ...graph,
      nodes: [...graph.nodes, { ...project }],
      edges: [
        ...graph.edges,
        // Dangling endpoint.
        knowledgeEdge(
          "kge_x1",
          "states",
          "kgn_ghost",
          source.id,
          graph.projectId,
          "derived",
          "unverified",
          {
            refs: [{ factId: "x" }],
          },
        ),
        // Grammar violation: a project cannot be extracted from anything.
        knowledgeEdge(
          "kge_x2",
          "extracted_from",
          project.id,
          source.id,
          graph.projectId,
          "derived",
          "unverified",
          {
            refs: [{ factId: "x" }],
          },
        ),
        // Duplicate edge id.
        { ...graph.edges[0] },
      ],
      sourceIds: [...graph.sourceIds, "psrc_phantom"],
    };
    const issueCodes = codes(validateKnowledgeGraph(tampered));
    expect(issueCodes).toContain("duplicate_node_id");
    expect(issueCodes).toContain("duplicate_node_key");
    expect(issueCodes).toContain("unknown_node_reference");
    expect(issueCodes).toContain("incompatible_edge_endpoints");
    expect(issueCodes).toContain("duplicate_edge_id");
    expect(issueCodes).toContain("unknown_source_reference");
  });

  it("flags mixed-kind succession and cross-subject contradiction", () => {
    const graph = makeGraph();
    const fact = graph.nodes.find((node) => node.kind === "fact")!;
    const source = graph.nodes.find((node) => node.kind === "source")!;
    const claim = graph.nodes.find((node) => node.kind === "claim")!;
    const otherClaim = knowledgeNode(
      "kgn_claim-x",
      "claim",
      "proj_coralina:developer#1",
      graph.projectId,
      {
        subjectKey: "proj_coralina:developer",
        standing: "unverified",
        refs: [{ subjectKey: "proj_coralina:developer" }],
      },
    );
    const tampered = {
      ...graph,
      nodes: [...graph.nodes, otherClaim],
      edges: [
        ...graph.edges,
        knowledgeEdge(
          "kge_y1",
          "supersedes",
          fact.id,
          source.id,
          graph.projectId,
          "derived",
          "unverified",
          {
            refs: [{ factId: fact.key }],
          },
        ),
        knowledgeEdge(
          "kge_y2",
          "contradicts",
          claim.id,
          otherClaim.id,
          graph.projectId,
          "derived",
          "disputed",
          {
            refs: [{ subjectKey: claim.subjectKey! }],
          },
        ),
        knowledgeEdge(
          "kge_y3",
          "contradicts",
          claim.id,
          claim.id,
          graph.projectId,
          "derived",
          "disputed",
          {
            refs: [{ subjectKey: claim.subjectKey! }],
          },
        ),
      ],
    };
    const issueCodes = codes(validateKnowledgeGraph(tampered));
    expect(issueCodes).toContain("mixed_kind_succession");
    expect(issueCodes).toContain("cross_subject_contradiction");
    expect(issueCodes).toContain("self_contradiction");
  });

  it("flags nodes and edges belonging to another project", () => {
    const graph = makeGraph();
    const tampered = {
      ...graph,
      nodes: graph.nodes.map((node, index) =>
        index === 0 ? { ...node, projectId: "proj_other" } : node,
      ),
      edges: graph.edges.map((edge, index) =>
        index === 0 ? { ...edge, projectId: "proj_other" } : edge,
      ),
    };
    const issueCodes = codes(validateKnowledgeGraph(tampered));
    expect(issueCodes).toContain("foreign_node");
    expect(issueCodes).toContain("foreign_edge");
  });
});
