import { describe, expect, it } from "vitest";

import {
  describeKnowledgeGraph,
  knowledgeStandingForConsensus,
  listKnowledgeClaims,
  listKnowledgeClaimsRequiringReview,
  listKnowledgeEdgesByKind,
  knowledgeGraphRequiresReview,
} from "..";
import {
  PRICE_SUBJECT,
  makeConflictingFact,
  makeContestedGraph,
  makeContext,
  makeEntity,
  makeFact,
  makeGraph,
  makeRelation,
  makeReport,
  makeRequest,
  runGraph,
} from "./fixtures";

describe("uncertainty is preserved, never resolved", () => {
  it("marks the corroborated claim corroborated only because RC4.7 judged it", () => {
    const claim = listKnowledgeClaims(makeGraph(), PRICE_SUBJECT)[0];
    expect(claim.standing).toBe("corroborated");
  });

  it("stays explicitly unverified without a report — agreement alone proves nothing here", () => {
    const graph = runGraph({ report: undefined }, {}).data[0];
    const claim = listKnowledgeClaims(graph, PRICE_SUBJECT)[0];
    expect(claim.standing).toBe("unverified");
    expect(listKnowledgeEdgesByKind(graph, "contradicts")).toHaveLength(0);
  });

  it("keeps every side of a contested subject standing as its own disputed claim", () => {
    const graph = makeContestedGraph();
    const claims = listKnowledgeClaims(graph, PRICE_SUBJECT);
    expect(claims).toHaveLength(2);
    expect(claims.every((claim) => claim.standing === "disputed")).toBe(true);
    const contradicts = listKnowledgeEdgesByKind(graph, "contradicts");
    expect(contradicts).toHaveLength(1);
    expect(contradicts[0].standing).toBe("disputed");
    expect(knowledgeGraphRequiresReview(graph)).toBe(true);
    expect(listKnowledgeClaimsRequiringReview(graph)).toHaveLength(2);
  });

  it("never manufactures a contradiction the examination did not judge", () => {
    // Same facts, but no report in hand: two claims, no contradicts edge —
    // the disagreement may be incomparability, and RC4.8 never re-judges.
    const facts = [makeFact(), makeConflictingFact()];
    const graph = runGraph({ report: undefined }, { facts }).data[0];
    expect(listKnowledgeClaims(graph, PRICE_SUBJECT)).toHaveLength(2);
    expect(listKnowledgeEdgesByKind(graph, "contradicts")).toHaveLength(0);
    expect(
      listKnowledgeClaims(graph, PRICE_SUBJECT).every((claim) => claim.standing === "unverified"),
    ).toBe(true);
  });

  it("marks incomparable subjects incomparable, exactly as RC4.7 judged them", () => {
    const facts = [makeFact(), makeConflictingFact({ language: "th" })];
    const report = makeReport(facts);
    const graph = runGraph({ report }, { facts }).data[0];
    const claims = listKnowledgeClaims(graph, PRICE_SUBJECT);
    expect(claims.every((claim) => claim.standing === "incomparable")).toBe(true);
    expect(listKnowledgeEdgesByKind(graph, "contradicts")).toHaveLength(0);
  });

  it("marks a claim stated only by superseded readings stale", () => {
    const facts = [makeFact({ status: "superseded", supersededBy: "xfact_coralina-newer" })];
    const graph = runGraph({ report: undefined }, { facts }).data[0];
    const claim = listKnowledgeClaims(graph, PRICE_SUBJECT)[0];
    expect(claim.standing).toBe("stale");
    const states = listKnowledgeEdgesByKind(graph, "states");
    expect(states[0].standing).toBe("stale");
  });

  it("marks a stated absence unavailable — absence is data, not silence", () => {
    const facts = [
      makeFact({
        status: "unavailable",
        rawValue: undefined,
        structuredValue: undefined,
        excerpt: undefined,
      }),
    ];
    const graph = runGraph({ report: undefined }, { facts }).data[0];
    const claim = listKnowledgeClaims(graph, PRICE_SUBJECT)[0];
    expect(claim.standing).toBe("unavailable");
  });

  it("represents an expected-but-unaddressed subject as missing knowledge", () => {
    const report = makeReport([]);
    // An RC4.7 examination with expected paths would assess the uncovered
    // subject as unaddressed; simulate through the reused shape directly.
    const unaddressed = {
      ...report,
      subjects: [
        {
          subject: {
            key: "proj_coralina:unknown:pricing.basePrice",
            projectId: "proj_coralina",
            factType: "unknown" as const,
            fieldPath: "pricing.basePrice",
          },
          readings: [],
          consensus: "unaddressed" as const,
          findingIds: [],
        },
      ],
    };
    const graph = describeKnowledgeGraph(makeContext({ report: unaddressed }), {
      projectSlug: "coralina",
    }).data[0];
    const claims = listKnowledgeClaims(graph, "proj_coralina:unknown:pricing.basePrice");
    expect(claims).toHaveLength(1);
    expect(claims[0].standing).toBe("missing");
    expect(claims[0].signature).toBeUndefined();
    const addresses = listKnowledgeEdgesByKind(graph, "addresses");
    expect(addresses).toHaveLength(1);
    expect(addresses[0].standing).toBe("missing");
  });

  it("maps the RC4.7 consensus vocabulary totally and conservatively", () => {
    expect(knowledgeStandingForConsensus("corroborated")).toBe("corroborated");
    expect(knowledgeStandingForConsensus("uncorroborated")).toBe("unverified");
    expect(knowledgeStandingForConsensus("contested")).toBe("disputed");
    expect(knowledgeStandingForConsensus("incomparable")).toBe("incomparable");
    expect(knowledgeStandingForConsensus("unaddressed")).toBe("missing");
    expect(knowledgeStandingForConsensus("something_else" as never)).toBe("unverified");
  });

  it("keeps declared relations unverified unless the grounding evidence says more", () => {
    const graph = runGraph({}, { entities: [makeEntity()], relations: [makeRelation()] }).data[0];
    const developedBy = listKnowledgeEdgesByKind(graph, "developed_by")[0];
    // The grounding fact is not part of the examined batch, so nothing has
    // judged it — the relation stays explicitly unverified.
    expect(developedBy.standing).toBe("unverified");
  });

  it("never marks a declared relation corroborated — RC4.7 corroborates values, not relationships", () => {
    // Even when every grounding fact belongs to a subject RC4.7 judged
    // corroborated, nothing anywhere judged the *relation*: corroboration of
    // a price value is not corroboration of a refers_to statement, and
    // upgrading the edge would launder certainty from one statement onto
    // another. `unverified` is the ceiling of every declared relation.
    const facts = [
      makeFact(),
      makeFact({ factSlug: "price-1br-brochure", sourceId: "psrc_coralina-brochure-v1-0-0" }),
    ];
    const report = makeReport(facts);
    const relation = makeRelation({
      kind: "refers_to",
      from: { kind: "source", key: "psrc_coralina-price-list-v1-0-0" },
      to: { kind: "developer", key: "coralina-development" },
      refs: [{ factId: facts[0].id }],
    });
    const graph = describeKnowledgeGraph(
      makeContext({ report }),
      makeRequest({ facts, entities: [makeEntity()], relations: [relation] }),
    ).data[0];
    const refersTo = listKnowledgeEdgesByKind(graph, "refers_to")[0];
    expect(refersTo.standing).toBe("unverified");
  });

  it("marks a declared relation disputed when its grounding subject is contested", () => {
    const facts = [makeFact(), makeConflictingFact()];
    const report = makeReport(facts);
    const relation = makeRelation({
      refs: [{ factId: facts[0].id }],
    });
    const graph = describeKnowledgeGraph(
      makeContext({ report }),
      makeRequest({ facts, entities: [makeEntity()], relations: [relation] }),
    ).data[0];
    const developedBy = listKnowledgeEdgesByKind(graph, "developed_by")[0];
    expect(developedBy.standing).toBe("disputed");
  });

  it("raises the unresolved-knowledge warning only when something is unresolved", () => {
    const contested = [makeFact(), makeConflictingFact()];
    const disputed = runGraph({ report: makeReport(contested) }, { facts: contested });
    expect(disputed.warnings.some((warning) => warning.code === "unresolved_knowledge")).toBe(true);
    expect(disputed.metadata.unresolvedCount).toBeGreaterThan(0);

    const settled = runGraph();
    expect(settled.warnings.some((warning) => warning.code === "unresolved_knowledge")).toBe(false);
    expect(settled.metadata.unresolvedCount).toBe(0);
  });
});
