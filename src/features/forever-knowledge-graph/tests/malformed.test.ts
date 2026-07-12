import { describe, expect, it } from "vitest";

import {
  describeKnowledgeGraph,
  validateKnowledgeEdge,
  validateKnowledgeEntityDeclaration,
  validateKnowledgeGraph,
  validateKnowledgeGraphCatalog,
  validateKnowledgeGraphHistory,
  validateKnowledgeNode,
  validateKnowledgeRef,
  validateKnowledgeRelationDeclaration,
} from "..";
import type { KnowledgeGraph } from "..";
import { makeContext, makeFact, makeGraph, makeRequest } from "./fixtures";

describe("deeply malformed input never throws", () => {
  it("an absent request settles into a structured failure", () => {
    const result = describeKnowledgeGraph(makeContext(), null as never);
    expect(result.ok).toBe(false);
    expect(result.data).toHaveLength(0);
    expect(result.errors[0].code).toBe("missing_graph_project");
  });

  it("a request naming no usable project settles into a structured failure", () => {
    for (const projectSlug of ["", "   ", "///", 42 as never]) {
      const result = describeKnowledgeGraph(makeContext(), { projectSlug });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe("missing_graph_project");
    }
  });

  it("non-list request collections settle into structured failures", () => {
    for (const overrides of [
      { facts: "not-a-list" as never },
      { entities: 7 as never },
      { relations: {} as never },
    ]) {
      const result = describeKnowledgeGraph(makeContext(), makeRequest(overrides));
      expect(result.ok).toBe(false);
      expect(result.data).toHaveLength(0);
    }
  });

  it("an absent context still describes — nothing in it is required", () => {
    const result = describeKnowledgeGraph(null as never, { projectSlug: "coralina" });
    expect(result.data).toHaveLength(1);
    expect(validateKnowledgeGraph(result.data[0])).toEqual([]);
  });

  it("malformed context collaborators are warned about and described around", () => {
    const result = describeKnowledgeGraph(
      {
        sources: "garbage" as never,
        record: 42 as never,
        merge: "nope" as never,
        report: true as never,
        now: 99 as never,
      },
      makeRequest(),
    );
    expect(result.data).toHaveLength(1);
    const codes = result.warnings.map((warning) => warning.code);
    expect(codes).toContain("invalid_registered_sources");
    expect(codes).toContain("invalid_graph_record");
    expect(codes).toContain("invalid_graph_merge");
    expect(codes).toContain("invalid_graph_report");
    expect(codes).toContain("invalid_graph_now");
    expect(validateKnowledgeGraph(result.data[0])).toEqual([]);
  });

  it("malformed entries inside context collaborators are set aside, never dereferenced", () => {
    const result = describeKnowledgeGraph(
      makeContext({
        sources: [null as never, {} as never, ...(makeContext().sources ?? [])],
        report: {
          ...makeContext().report!,
          subjects: [null as never, { subject: {} } as never],
          findings: [null as never, { kind: "conflict" } as never],
        },
      }),
      makeRequest(),
    );
    expect(result.data).toHaveLength(1);
    const codes = result.warnings.map((warning) => warning.code);
    expect(codes).toContain("malformed_registered_source");
    expect(codes).toContain("malformed_report_assessment");
    expect(codes).toContain("malformed_report_finding");
    expect(validateKnowledgeGraph(result.data[0])).toEqual([]);
  });

  it("a hostile fact with a throwing accessor is excluded, not thrown out of", () => {
    const hostile = new Proxy(makeFact(), {
      get(target, property, receiver) {
        if (property === "factType") throw new Error("hostile accessor");
        return Reflect.get(target, property, receiver);
      },
    });
    const result = describeKnowledgeGraph(
      makeContext({ report: undefined }),
      makeRequest({ facts: [hostile, makeFact({ factSlug: "safe" })] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === "unrepresentable_fact")).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it("a hostile context that throws on first touch settles into one structured failure", () => {
    const hostileContext = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile context");
        },
      },
    ) as never;
    const result = describeKnowledgeGraph(hostileContext, makeRequest());
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("undescribable_input");
  });

  it("an uncloneable declaration is excluded alone — never the whole graph", () => {
    const result = describeKnowledgeGraph(
      makeContext({ report: undefined }),
      makeRequest({
        entities: [
          {
            kind: "developer",
            slug: "acme",
            refs: [{ sourceId: "psrc_x" }],
            // A function cannot survive structuredClone.
            toJSON: () => "x",
          } as never,
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === "malformed_entity_declaration")).toBe(true);
    // The rest of the description survives — the blast radius is one slot.
    expect(result.data).toHaveLength(1);
    expect(result.data[0].nodes.length).toBeGreaterThan(0);
    expect(validateKnowledgeGraph(result.data[0])).toEqual([]);
  });

  it("every validator answers absent input with one missing_* issue", () => {
    expect(validateKnowledgeRef(null as never)[0].code).toBe("missing_ref");
    expect(validateKnowledgeNode(null as never)[0].code).toBe("missing_node");
    expect(validateKnowledgeEdge(null as never)[0].code).toBe("missing_edge");
    expect(validateKnowledgeEntityDeclaration(null as never)[0].code).toBe(
      "missing_entity_declaration",
    );
    expect(validateKnowledgeRelationDeclaration(null as never)[0].code).toBe(
      "missing_relation_declaration",
    );
    expect(validateKnowledgeGraph(null as never)[0].code).toBe("missing_graph");
    expect(validateKnowledgeGraphHistory(null as never)[0].code).toBe("missing_history");
    expect(validateKnowledgeGraphCatalog(null as never)[0].code).toBe("missing_catalog");
  });

  it("validators walk deeply garbled structures without throwing", () => {
    const garbled = {
      id: 7,
      projectId: null,
      projectSlug: "",
      batch: "",
      describedAt: "",
      nodes: [null, { kind: "nonsense", refs: "x" }, { kind: "claim", refs: [null, {}] }],
      edges: [null, { kind: "supports", refs: [], standing: "sure", origin: "guessed" }],
      sourceIds: [null, "", "dup", "dup"],
    } as unknown as KnowledgeGraph;
    const issues = validateKnowledgeGraph(garbled);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.severity === "error")).toBe(true);
  });

  it("a coherent described graph passes every validator cleanly", () => {
    expect(validateKnowledgeGraph(makeGraph())).toEqual([]);
  });
});
