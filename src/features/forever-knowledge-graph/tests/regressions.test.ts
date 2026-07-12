import { describe, expect, it } from "vitest";

import {
  describeKnowledgeGraph,
  findKnowledgeNode,
  knowledgeNode,
  listKnowledgeClaims,
  listKnowledgeEdgesByKind,
  listKnowledgeNodesByKind,
  validateKnowledgeGraph,
  validateKnowledgeNode,
} from "..";
import {
  PRICE_SUBJECT,
  makeConflictingFact,
  makeContext,
  makeEntity,
  makeFact,
  makeGraph,
  makeReport,
  makeRequest,
} from "./fixtures";

describe("adversarial regressions", () => {
  it("a subject key containing separators never smears support groups together", () => {
    // A field path with spaces (legal at the RC4.5 level — only emptiness is
    // structural) flows into the subject key and the claim key; grouping and
    // resolution must stay exact, never re-parsed out of a composite string.
    const spaced = makeFact({ factSlug: "spaced", fieldPath: "weird path.with spaces" });
    const result = describeKnowledgeGraph(makeContext({ report: undefined }), {
      projectSlug: "coralina",
      facts: [spaced, makeFact()],
    });
    const graph = result.data[0];
    expect(validateKnowledgeGraph(graph)).toEqual([]);
    const supports = listKnowledgeEdgesByKind(graph, "supports");
    expect(supports).toHaveLength(2);
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    expect(supports.every((edge) => nodeIds.has(edge.fromId) && nodeIds.has(edge.toId))).toBe(true);
  });

  it("an assessed-only subject can never collide with a fact-stated claim key", () => {
    // The fact's subject key ends up "…:price:weird#1"-shaped once its claim
    // ordinal is appended; a hostile report subject named exactly like that
    // claim key must still get its own node, not silently merge.
    const hash = makeFact({ factSlug: "hash", fieldPath: "weird#1".slice(0, 7) });
    const factSubject = "proj_coralina:price:weird#1";
    const report = {
      ...makeReport([]),
      subjects: [
        {
          subject: {
            key: `${factSubject}#1`,
            projectId: "proj_coralina",
            factType: "unknown" as const,
          },
          readings: [],
          consensus: "unaddressed" as const,
          findingIds: [],
        },
      ],
      findings: [],
      standings: [],
    };
    const result = describeKnowledgeGraph(makeContext({ report }), {
      projectSlug: "coralina",
      facts: [hash],
    });
    const graph = result.data[0];
    expect(validateKnowledgeGraph(graph)).toEqual([]);
    // Both the fact-stated claim and the assessed-only claim stand apart.
    expect(listKnowledgeClaims(graph, factSubject)).toHaveLength(1);
    expect(listKnowledgeClaims(graph, `${factSubject}#1`)).toHaveLength(1);
    expect(listKnowledgeClaims(graph, `${factSubject}#1`)[0].standing).toBe("missing");
  });

  it("distinct keys that slugify identically never conflate — ids disambiguate and edges survive", () => {
    // The reused slug rule collapses `_` and `.` runs to `-`, so these two
    // fact ids derive the same base node id. They must stay two nodes with
    // two distinct ids, two extracted_from edges, a collision warning — and
    // the output must still pass the module's own validator.
    const result = describeKnowledgeGraph(
      { now: "2026-07-12T00:00:00.000Z" },
      {
        projectSlug: "coralina",
        facts: [
          { ...makeFact({ rawValue: "1", structuredValue: 1 }), id: "xfact_coralina-twin_a.1" },
          { ...makeFact({ rawValue: "2", structuredValue: 2 }), id: "xfact_coralina-twin-a-1" },
        ],
      },
    );
    const graph = result.data[0];
    expect(validateKnowledgeGraph(graph)).toEqual([]);
    const factNodes = listKnowledgeNodesByKind(graph, "fact");
    expect(factNodes).toHaveLength(2);
    expect(new Set(factNodes.map((node) => node.id)).size).toBe(2);
    expect(listKnowledgeEdgesByKind(graph, "extracted_from")).toHaveLength(2);
    expect(result.warnings.some((warning) => warning.code === "colliding_node_identity")).toBe(
      true,
    );
  });

  it("a consensus is never stretched over a reading the examination never judged", () => {
    // RC4.7 corroborated the 4.59M price over two agreeing readings. The
    // graph request then adds a conflicting 4.79M reading the examination
    // never saw: the judged claim keeps its corroboration, the unjudged
    // claim stays explicitly unverified, and no contradiction is invented.
    const judged = [
      makeFact(),
      makeFact({ factSlug: "price-1br-b", sourceId: "psrc_coralina-brochure-v1-0-0" }),
    ];
    const report = makeReport(judged);
    const unseen = makeConflictingFact({ factSlug: "price-1br-late" });
    const graph = describeKnowledgeGraph(
      makeContext({ report }),
      makeRequest({ facts: [...judged, unseen] }),
    ).data[0];
    const claims = listKnowledgeClaims(graph, PRICE_SUBJECT);
    expect(claims).toHaveLength(2);
    const standings = new Map(claims.map((claim) => [claim.signature, claim.standing]));
    const judgedSignature = claims.find((claim) =>
      claim.refs.some((ref) => ref.factId === judged[0].id),
    )!.signature;
    const unseenSignature = claims.find((claim) =>
      claim.refs.some((ref) => ref.factId === unseen.id),
    )!.signature;
    expect(standings.get(judgedSignature)).toBe("corroborated");
    expect(standings.get(unseenSignature)).toBe("unverified");
    expect(listKnowledgeEdgesByKind(graph, "contradicts")).toHaveLength(0);
  });

  it("a judged dispute outranks staleness — an aged disagreement stays in the review set", () => {
    const facts = [makeFact(), makeConflictingFact()];
    const report = makeReport(facts);
    const aged = [
      makeFact({ status: "superseded", supersededBy: "xfact_coralina-newer" }),
      makeConflictingFact(),
    ];
    const graph = describeKnowledgeGraph(makeContext({ report }), makeRequest({ facts: aged }))
      .data[0];
    const claims = listKnowledgeClaims(graph, PRICE_SUBJECT);
    expect(claims.every((claim) => claim.standing === "disputed")).toBe(true);
  });

  it("the extraction pipeline's own disputed status is carried, never dropped", () => {
    const disputed = makeFact({ status: "disputed", conflictsWith: ["xfact_coralina-rival"] });
    const graph = describeKnowledgeGraph(makeContext({ report: undefined }), {
      projectSlug: "coralina",
      facts: [disputed],
    }).data[0];
    const claim = listKnowledgeClaims(graph, PRICE_SUBJECT)[0];
    expect(claim.standing).toBe("disputed");
    const states = listKnowledgeEdgesByKind(graph, "states");
    expect(states[0].standing).toBe("disputed");
  });

  it("an incoherent declaration reference is dropped, never emitted for validation to reject", () => {
    const entity = makeEntity({
      refs: [
        { factId: "xfact_coralina-dev", sourceId: "" }, // empty part — incoherent
        { sourceId: "psrc_coralina-brochure-v1-0-0" }, // coherent
      ],
    });
    const result = describeKnowledgeGraph(
      makeContext({ report: undefined }),
      makeRequest({ entities: [entity] }),
    );
    const graph = result.data[0];
    expect(validateKnowledgeGraph(graph)).toEqual([]);
    const developer = findKnowledgeNode(graph, "developer", "coralina-development")!;
    expect(developer.refs).toEqual([{ sourceId: "psrc_coralina-brochure-v1-0-0" }]);
    expect(result.warnings.some((warning) => warning.code === "dropped_incoherent_ref")).toBe(true);
  });

  it("one uncloneable fact excludes that slot alone — never the whole graph", () => {
    const hostileConfidence = makeFact({ factSlug: "hostile" });
    (hostileConfidence.confidence as { junk?: unknown }).junk = () => 1;
    const result = describeKnowledgeGraph(
      makeContext({ report: undefined }),
      makeRequest({ facts: [hostileConfidence, makeFact()] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === "unrepresentable_fact")).toBe(true);
    const graph = result.data[0];
    expect(listKnowledgeNodesByKind(graph, "fact")).toHaveLength(1);
    expect(validateKnowledgeGraph(graph)).toEqual([]);
  });

  it("unregistered-source grounding is order-invariant: reordered batches yield byte-identical graphs", () => {
    const facts = [makeFact(), makeFact({ factSlug: "price-2br" })];
    const forward = describeKnowledgeGraph(
      { now: "2026-07-12T00:00:00.000Z" },
      { projectSlug: "coralina", facts },
    ).data[0];
    const backward = describeKnowledgeGraph(
      { now: "2026-07-12T00:00:00.000Z" },
      { projectSlug: "coralina", facts: [...facts].reverse() },
    ).data[0];
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
  });

  it("an all-punctuation batch is ignored with a warning, never truncated into the id", () => {
    const result = describeKnowledgeGraph(makeContext(), makeRequest({ batch: "###" }));
    expect(result.data[0].id).toBe("kgr_coralina");
    expect(result.data[0].batch).toBeUndefined();
    expect(result.warnings.some((warning) => warning.code === "invalid_graph_batch")).toBe(true);
  });

  it("validators report holes instead of skipping them", () => {
    const graph = makeGraph();
    const holed = { ...graph, nodes: [...graph.nodes] };
    holed.nodes.length += 2; // two trailing holes
    const issues = validateKnowledgeGraph(holed);
    expect(issues.filter((issue) => issue.code === "missing_node")).toHaveLength(2);
  });

  it("validators never throw, even on throwing accessors", () => {
    const hostile = Object.create({
      get id() {
        throw new Error("hostile accessor");
      },
    });
    const issues = validateKnowledgeNode(hostile);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("unvalidatable_input");

    const hostileGraph = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile graph");
        },
      },
    );
    expect(validateKnowledgeGraph(hostileGraph as never)[0].code).toBe("unvalidatable_input");
  });

  it("colliding claim keys across kinds still validate as one coherent graph", () => {
    // Belt-and-braces: hand-build a node whose claim-only facts sit on a
    // claim node — the validator accepts it, while the same facts on a
    // source node stay rejected.
    const claim = knowledgeNode("kgn_x-claim-a-1", "claim", "a#1", "proj_x", {
      subjectKey: "a",
      signature: "{}",
      standing: "unverified",
      refs: [{ subjectKey: "a" }],
    });
    expect(validateKnowledgeNode(claim)).toEqual([]);
  });
});
