import { describe, expect, it } from "vitest";

import {
  describeKnowledgeGraph,
  findKnowledgeNode,
  listKnowledgeClaims,
  listKnowledgeEdgesByKind,
  listKnowledgeEdgesFrom,
  listKnowledgeEdgesTo,
  listKnowledgeNodesByKind,
  listKnowledgeSourcesContradictingClaim,
  listKnowledgeSourcesSupportingClaim,
} from "..";
import {
  BROCHURE_ID,
  PRICE_LIST_ID,
  PRICE_SUBJECT,
  makeContestedGraph,
  makeContext,
  makeEntity,
  makeFact,
  makeGraph,
  makeMerge,
  makeRecord,
  makeRelation,
  makeReport,
  makeRequest,
  makeSources,
  makeTranslationSource,
  runGraph,
} from "./fixtures";

describe("describeKnowledgeGraph — nodes", () => {
  it("derives the project node with the graph identity", () => {
    const graph = makeGraph();
    expect(graph.id).toBe("kgr_coralina");
    expect(graph.projectId).toBe("proj_coralina");
    const project = findKnowledgeNode(graph, "project", "coralina");
    expect(project).toBeDefined();
    expect(project!.refs).toEqual([{ projectId: "proj_coralina" }]);
  });

  it("derives one source node per registered source, grounded in itself", () => {
    const graph = makeGraph();
    const sources = listKnowledgeNodesByKind(graph, "source");
    expect(sources.map((node) => node.key).sort()).toEqual([PRICE_LIST_ID, BROCHURE_ID].sort());
    const priceList = findKnowledgeNode(graph, "source", PRICE_LIST_ID)!;
    expect(priceList.refs[0].sourceId).toBe(PRICE_LIST_ID);
    expect(priceList.refs[0].sourceVersion).toEqual({ major: 1, minor: 0, patch: 0 });
  });

  it("derives one fact node per representable fact", () => {
    const graph = makeGraph();
    const facts = listKnowledgeNodesByKind(graph, "fact");
    expect(facts.map((node) => node.key)).toContain(makeFact().id);
    expect(facts).toHaveLength(2);
  });

  it("derives one claim per distinct reused value signature per subject", () => {
    const agreed = makeGraph();
    expect(listKnowledgeClaims(agreed, PRICE_SUBJECT)).toHaveLength(1);

    const contested = makeContestedGraph();
    const claims = listKnowledgeClaims(contested, PRICE_SUBJECT);
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map((claim) => claim.signature)).size).toBe(2);
  });

  it("represents a source a fact names even when it is not registered, and says so", () => {
    const result = runGraph({ sources: [] }, {});
    const graph = result.data[0];
    const priceList = findKnowledgeNode(graph, "source", PRICE_LIST_ID)!;
    expect(priceList.refs[0]).toEqual({ sourceId: PRICE_LIST_ID, factId: makeFact().id });
    expect(result.warnings.some((warning) => warning.code === "unregistered_source")).toBe(true);
  });

  it("does not warn about unregistered sources when no registry was supplied", () => {
    const result = runGraph({ sources: undefined }, {});
    expect(result.warnings.some((warning) => warning.code === "unregistered_source")).toBe(false);
  });

  it("derives field and revision nodes from the canonical record", () => {
    const graph = runGraph({ record: makeRecord() }, {}).data[0];
    const field = findKnowledgeNode(graph, "field", "pricing.basePrice");
    expect(field).toBeDefined();
    expect(field!.label).toBe("Base price");
    expect(listKnowledgeNodesByKind(graph, "revision").map((node) => node.key)).toEqual([
      "prev_coralina-r1",
      "prev_coralina-r2",
    ]);
  });

  it("derives finding nodes from the RC4.7 report", () => {
    const graph = makeGraph();
    const findings = listKnowledgeNodesByKind(graph, "finding");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((node) => node.refs.some((ref) => ref.findingId === node.key))).toBe(
      true,
    );
  });

  it("derives a field node from fact field paths even without a record", () => {
    const graph = runGraph({ record: undefined }, {}).data[0];
    const field = findKnowledgeNode(graph, "field", "pricing.basePrice");
    expect(field).toBeDefined();
    expect(field!.refs[0]).toEqual({ path: "pricing.basePrice" });
  });

  it("admits a grounded entity declaration as a node", () => {
    const graph = runGraph({}, { entities: [makeEntity()] }).data[0];
    const developer = findKnowledgeNode(graph, "developer", "coralina-development");
    expect(developer).toBeDefined();
    expect(developer!.label).toBe("Coralina Development Co.");
    expect(developer!.refs.length).toBeGreaterThan(0);
  });

  it("excludes an ungrounded entity declaration with a structured error", () => {
    const result = runGraph({}, { entities: [makeEntity({ refs: [] })] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === "ungrounded_entity")).toBe(true);
    expect(findKnowledgeNode(result.data[0], "developer", "coralina-development")).toBeUndefined();
  });
});

describe("describeKnowledgeGraph — edges", () => {
  it("derives describes edges from registered sources to the project", () => {
    const graph = makeGraph();
    const describes = listKnowledgeEdgesByKind(graph, "describes");
    expect(describes).toHaveLength(2);
    const project = findKnowledgeNode(graph, "project", "coralina")!;
    expect(describes.every((edge) => edge.toId === project.id)).toBe(true);
  });

  it("derives extracted_from edges carrying the fact's own confidence", () => {
    const graph = makeGraph();
    const extracted = listKnowledgeEdgesByKind(graph, "extracted_from");
    expect(extracted).toHaveLength(2);
    expect(extracted.every((edge) => edge.confidence?.level === "high")).toBe(true);
    expect(extracted.every((edge) => edge.origin === "derived")).toBe(true);
  });

  it("derives states edges from facts to their claims", () => {
    const graph = makeGraph();
    const claim = listKnowledgeClaims(graph, PRICE_SUBJECT)[0];
    const states = listKnowledgeEdgesByKind(graph, "states");
    expect(states).toHaveLength(2);
    expect(states.every((edge) => edge.toId === claim.id)).toBe(true);
  });

  it("derives addresses edges from claims to their canonical fields", () => {
    const graph = makeGraph();
    const addresses = listKnowledgeEdgesByKind(graph, "addresses");
    expect(addresses).toHaveLength(1);
    const field = findKnowledgeNode(graph, "field", "pricing.basePrice")!;
    expect(addresses[0].toId).toBe(field.id);
  });

  it("derives supports edges from sources to the claims their facts state", () => {
    const graph = makeGraph();
    const claim = listKnowledgeClaims(graph, PRICE_SUBJECT)[0];
    const supporters = listKnowledgeSourcesSupportingClaim(graph, claim.id);
    expect(supporters).toHaveLength(2);
  });

  it("derives the RC4.4 relationship chains exactly as declared", () => {
    const graph = runGraph({ sources: [...makeSources(), makeTranslationSource()] }, {}).data[0];
    const translation = listKnowledgeEdgesByKind(graph, "translation_of");
    expect(translation).toHaveLength(1);
    const from = findKnowledgeNode(graph, "source", "psrc_coralina-brochure-th-v1-0-0")!;
    const to = findKnowledgeNode(graph, "source", BROCHURE_ID)!;
    expect(translation[0].fromId).toBe(from.id);
    expect(translation[0].toId).toBe(to.id);
  });

  it("derives supersedes edges along the record's declared revision chain", () => {
    const graph = runGraph({ record: makeRecord() }, {}).data[0];
    const succession = listKnowledgeEdgesByKind(graph, "supersedes");
    expect(succession).toHaveLength(1);
    const r2 = findKnowledgeNode(graph, "revision", "prev_coralina-r2")!;
    const r1 = findKnowledgeNode(graph, "revision", "prev_coralina-r1")!;
    expect(succession[0].fromId).toBe(r2.id);
    expect(succession[0].toId).toBe(r1.id);
  });

  it("derives supports edges from the facts the record's values settled from", () => {
    const graph = runGraph({ record: makeRecord() }, {}).data[0];
    const field = findKnowledgeNode(graph, "field", "pricing.basePrice")!;
    const fact = findKnowledgeNode(graph, "fact", makeFact().id)!;
    const supports = listKnowledgeEdgesByKind(graph, "supports").filter(
      (edge) => edge.toId === field.id,
    );
    expect(supports).toHaveLength(1);
    expect(supports[0].fromId).toBe(fact.id);
  });

  it("derives conflicts_with edges from the RC4.6 merge's unresolved conflicts", () => {
    const merge = makeMerge();
    expect(merge.conflicts).toHaveLength(1);
    const graph = runGraph({ record: makeRecord(), merge }, {}).data[0];
    const conflicts = listKnowledgeEdgesByKind(graph, "conflicts_with");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].standing).toBe("disputed");
    const field = findKnowledgeNode(graph, "field", "pricing.basePrice")!;
    expect(conflicts[0].toId).toBe(field.id);
  });

  it("derives conflicts_with edges from the facts' own declared conflicts", () => {
    const disputed = makeFact({ status: "disputed", conflictsWith: ["xfact_coralina-other"] });
    const graph = runGraph({ report: undefined }, { facts: [disputed] }).data[0];
    const conflicts = listKnowledgeEdgesByKind(graph, "conflicts_with");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].standing).toBe("disputed");
    expect(findKnowledgeNode(graph, "fact", "xfact_coralina-other")).toBeDefined();
  });

  it("derives supersedes edges from a fact's declared replacement", () => {
    const superseded = makeFact({ status: "superseded", supersededBy: "xfact_coralina-newer" });
    const graph = runGraph({ report: undefined }, { facts: [superseded] }).data[0];
    const succession = listKnowledgeEdgesByKind(graph, "supersedes");
    expect(succession).toHaveLength(1);
    const successor = findKnowledgeNode(graph, "fact", "xfact_coralina-newer")!;
    expect(succession[0].fromId).toBe(successor.id);
  });

  it("derives affects edges from findings to what their references name", () => {
    const graph = makeGraph();
    const affects = listKnowledgeEdgesByKind(graph, "affects");
    expect(affects.length).toBeGreaterThan(0);
    const findingNodes = new Set(listKnowledgeNodesByKind(graph, "finding").map((node) => node.id));
    expect(affects.every((edge) => findingNodes.has(edge.fromId))).toBe(true);
  });

  it("admits a grounded relation declaration between resolvable endpoints", () => {
    const graph = runGraph({}, { entities: [makeEntity()], relations: [makeRelation()] }).data[0];
    const developedBy = listKnowledgeEdgesByKind(graph, "developed_by");
    expect(developedBy).toHaveLength(1);
    expect(developedBy[0].origin).toBe("declared");
    const project = findKnowledgeNode(graph, "project", "coralina")!;
    const developer = findKnowledgeNode(graph, "developer", "coralina-development")!;
    expect(developedBy[0].fromId).toBe(project.id);
    expect(developedBy[0].toId).toBe(developer.id);
  });

  it("excludes a relation whose endpoint the graph does not contain", () => {
    const result = runGraph({}, { relations: [makeRelation()] });
    expect(result.errors.some((error) => error.code === "unresolved_relation_endpoint")).toBe(true);
    expect(listKnowledgeEdgesByKind(result.data[0], "developed_by")).toHaveLength(0);
  });

  it("excludes a relation declared with a non-declarable kind", () => {
    const result = runGraph(
      {},
      {
        entities: [makeEntity()],
        relations: [makeRelation({ kind: "supports" })],
      },
    );
    expect(result.errors.some((error) => error.code === "undeclarable_relation")).toBe(true);
  });

  it("excludes a relation whose endpoints its kind cannot connect", () => {
    const result = runGraph(
      {},
      {
        entities: [makeEntity()],
        relations: [
          makeRelation({ kind: "located_in" }), // developer is not a location
        ],
      },
    );
    expect(result.errors.some((error) => error.code === "incompatible_relation_endpoints")).toBe(
      true,
    );
  });

  it("answers which sources contradict a claim through the described edges", () => {
    const graph = makeContestedGraph();
    const claims = listKnowledgeClaims(graph, PRICE_SUBJECT);
    const priceListClaim = claims.find((claim) =>
      claim.refs.some((ref) => ref.factId === makeFact().id),
    )!;
    const contradicting = listKnowledgeSourcesContradictingClaim(graph, priceListClaim.id);
    const brochure = findKnowledgeNode(graph, "source", BROCHURE_ID)!;
    expect(contradicting).toEqual([brochure.id]);
  });

  it("threads edges through the from/to query helpers coherently", () => {
    const graph = makeGraph();
    const fact = findKnowledgeNode(graph, "fact", makeFact().id)!;
    const outgoing = listKnowledgeEdgesFrom(graph, fact.id);
    expect(outgoing.map((edge) => edge.kind).sort()).toEqual(["extracted_from", "states"]);
    const source = findKnowledgeNode(graph, "source", PRICE_LIST_ID)!;
    expect(listKnowledgeEdgesTo(graph, source.id).some((edge) => edge.fromId === fact.id)).toBe(
      true,
    );
  });
});

describe("describeKnowledgeGraph — intake", () => {
  it("excludes malformed, duplicated, and foreign facts with structured errors", () => {
    const result = describeKnowledgeGraph(makeContext({ report: undefined }), {
      projectSlug: "coralina",
      facts: [
        makeFact(),
        makeFact(), // duplicate id
        { ...makeFact(), projectId: "proj_other" },
        null as never,
        { ...makeFact({ factSlug: "typed" }), factType: "made_up" as never },
      ],
    });
    expect(result.ok).toBe(false);
    const reasons = result.errors.filter((error) => error.code === "unrepresentable_fact");
    expect(reasons).toHaveLength(4);
    expect(listKnowledgeNodesByKind(result.data[0], "fact")).toHaveLength(1);
  });

  it("sets aside a record, merge, or report belonging to another project", () => {
    const foreignReport = makeReport();
    const result = runGraph(
      {
        record: { ...makeRecord(), identity: { ...makeRecord().identity, projectId: "proj_x" } },
        merge: { ...makeMerge(), projectId: "proj_x" },
        report: { ...foreignReport, projectId: "proj_x" },
      },
      {},
    );
    const codes = result.warnings.map((warning) => warning.code);
    expect(codes).toContain("foreign_record");
    expect(codes).toContain("foreign_merge");
    expect(codes).toContain("foreign_report");
    expect(listKnowledgeNodesByKind(result.data[0], "revision")).toHaveLength(0);
    expect(listKnowledgeNodesByKind(result.data[0], "finding")).toHaveLength(0);
  });

  it("counts the description deterministically into the reused RC4.0 stats", () => {
    const result = runGraph();
    const graph = result.data[0];
    expect(result.stats.stages).toBe(1);
    expect(result.stats.completed).toBe(graph.nodes.length + graph.edges.length);
    expect(result.stats.failed).toBe(0);
    expect(result.metadata.graphId).toBe(graph.id);
    expect(result.metadata.nodeCount).toBe(graph.nodes.length);
    expect(result.metadata.edgeCount).toBe(graph.edges.length);
    expect(result.metadata.factCount).toBe(2);
    expect(result.metadata.sourceCount).toBe(2);
    expect(result.metadata.claimCount).toBe(1);
    expect(result.metadata.describedAt).toBe("2026-07-12T00:00:00.000Z");
  });

  it("honours the caller-stated batch in the graph id", () => {
    const result = runGraph({}, { batch: "2026-07" });
    expect(result.data[0].id).toBe("kgr_coralina-2026-07");
    expect(result.data[0].batch).toBe("2026-07");
  });

  it("lists the graph's sources as the source nodes it represents", () => {
    const graph = makeGraph();
    expect(graph.sourceIds).toEqual(
      listKnowledgeNodesByKind(graph, "source").map((node) => node.key),
    );
  });
});
