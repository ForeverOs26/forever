import { describe, expect, it } from "vitest";

import {
  describeKnowledgeGraph,
  sortKnowledgeEdges,
  sortKnowledgeNodes,
  validateKnowledgeGraph,
} from "..";
import {
  makeConflictingFact,
  makeContext,
  makeEntity,
  makeFact,
  makeGraph,
  makeRecord,
  makeRelation,
  makeReport,
  makeRequest,
} from "./fixtures";

describe("deterministic foundation", () => {
  it("describeKnowledgeGraph is byte-identical for identical input", () => {
    const run = () =>
      describeKnowledgeGraph(
        makeContext({ record: makeRecord() }),
        makeRequest({ entities: [makeEntity()], relations: [makeRelation()] }),
      );
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("stamps no clock of its own: an unstamped context yields no timestamp anywhere", () => {
    const result = describeKnowledgeGraph(makeContext({ now: undefined }), makeRequest());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("describedAt");
  });

  it("mutates neither the context nor the request, and never aliases them", () => {
    const context = makeContext({ record: makeRecord() });
    const request = makeRequest({
      facts: [makeFact(), makeConflictingFact()],
      entities: [makeEntity()],
      relations: [makeRelation()],
    });
    const contextSnapshot = structuredClone(context);
    const requestSnapshot = structuredClone(request);
    const result = describeKnowledgeGraph(context, request);
    expect(context).toEqual(contextSnapshot);
    expect(request).toEqual(requestSnapshot);

    // Mutating the described graph must never reach back into the caller's
    // sources, record, report, facts, or declarations.
    const graph = result.data[0];
    graph.nodes.forEach((node) => node.refs.pop());
    graph.edges.forEach((edge) => edge.refs.pop());
    graph.nodes.pop();
    graph.edges.pop();
    graph.sourceIds.pop();
    expect(context).toEqual(contextSnapshot);
    expect(request).toEqual(requestSnapshot);
  });

  it("does not mutate what it sorts or validates", () => {
    const graph = makeGraph();
    const snapshot = structuredClone(graph);
    validateKnowledgeGraph(graph);
    sortKnowledgeNodes(graph.nodes);
    sortKnowledgeEdges(graph.edges);
    expect(graph).toEqual(snapshot);
  });

  it("validation is deterministic: identical input yields identical issues", () => {
    const graph = makeGraph();
    expect(validateKnowledgeGraph(graph)).toEqual(validateKnowledgeGraph(graph));
  });

  it("node and edge ids are stable across runs and unique within a graph", () => {
    const facts = [makeFact(), makeConflictingFact()];
    const run = () =>
      describeKnowledgeGraph(makeContext({ report: makeReport(facts) }), makeRequest({ facts }))
        .data[0];
    const first = run();
    const second = run();
    expect(first.nodes.map((node) => node.id)).toEqual(second.nodes.map((node) => node.id));
    expect(first.edges.map((edge) => edge.id)).toEqual(second.edges.map((edge) => edge.id));
    const nodeIds = first.nodes.map((node) => node.id);
    const edgeIds = first.edges.map((edge) => edge.id);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(new Set(edgeIds).size).toBe(edgeIds.length);
  });

  it("orders nodes and edges deterministically regardless of input order", () => {
    const facts = [makeFact(), makeConflictingFact()];
    const forward = describeKnowledgeGraph(
      makeContext({ report: makeReport(facts) }),
      makeRequest({ facts }),
    ).data[0];
    const backward = describeKnowledgeGraph(
      makeContext({ report: makeReport(facts) }),
      makeRequest({ facts: [...facts].reverse() }),
    ).data[0];
    expect(forward.nodes.map((node) => `${node.kind}:${node.key}`)).toEqual(
      backward.nodes.map((node) => `${node.kind}:${node.key}`),
    );
    expect(forward.edges.map((edge) => `${edge.kind}:${edge.fromId}:${edge.toId}`)).toEqual(
      backward.edges.map((edge) => `${edge.kind}:${edge.fromId}:${edge.toId}`),
    );
    expect(forward.edges.map((edge) => edge.id)).toEqual(backward.edges.map((edge) => edge.id));
  });

  it("the engine's own output always passes the module's own validator", () => {
    const richFacts = [
      makeFact(),
      makeConflictingFact(),
      makeFact({ factSlug: "old-price", status: "superseded", supersededBy: "xfact_coralina-x" }),
    ];
    const results = [
      describeKnowledgeGraph(makeContext(), makeRequest()),
      describeKnowledgeGraph(
        makeContext({ record: makeRecord(), report: makeReport(richFacts) }),
        makeRequest({
          facts: richFacts,
          entities: [makeEntity()],
          relations: [makeRelation()],
        }),
      ),
      describeKnowledgeGraph({ now: "2026-07-12T00:00:00.000Z" }, { projectSlug: "coralina" }),
    ];
    for (const result of results) {
      expect(result.data).toHaveLength(1);
      expect(validateKnowledgeGraph(result.data[0])).toEqual([]);
    }
  });
});
