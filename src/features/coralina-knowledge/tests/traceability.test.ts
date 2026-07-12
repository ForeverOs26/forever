import { describe, expect, it } from "vitest";

import { currentProjectFieldValue } from "@/features/forever-project-database";

import { buildCoralinaKnowledgeSlice } from "../slice";

const slice = buildCoralinaKnowledgeSlice();
const factIds = new Set(slice.extraction.facts.map((fact) => fact.id));
const sourceIds = new Set(slice.sources.definitions.map((source) => source.identity.id));

describe("Coralina RC5.0 traceability", () => {
  it("traces every canonical field value to a stated fact and registered source", () => {
    for (const field of slice.canonical.record.fields) {
      const value = currentProjectFieldValue(field);
      expect(value, `field ${field.path} has no current value`).toBeDefined();
      expect(value?.factId).toBeDefined();
      expect(factIds.has(value!.factId!), `field ${field.path} traces to unknown fact`).toBe(true);
      for (const sourceId of value?.sourceIds ?? []) {
        expect(sourceIds.has(sourceId), `field ${field.path} cites unknown source`).toBe(true);
      }
      expect(value?.evidence?.length).toBeGreaterThan(0);
      expect(value?.provenance).toBeDefined();
    }
  });

  it("records every merge change against the fact that caused it", () => {
    for (const change of slice.canonical.record.revisions[0]!.changes) {
      expect(change.factId).toBeDefined();
      expect(factIds.has(change.factId!)).toBe(true);
    }
  });

  it("lists exactly the stated sources on the cross-validation report", () => {
    for (const sourceId of slice.crossValidation.report.sourceIds) {
      expect(sourceIds.has(sourceId)).toBe(true);
    }
  });

  it("gives every fact a standing in the report (input order preserved)", () => {
    expect(slice.crossValidation.report.standings.map((standing) => standing.factId)).toEqual(
      slice.extraction.facts.map((fact) => fact.id),
    );
  });

  it("resolves every withheld fact's finding ids to report findings", () => {
    const findingIds = new Set(slice.crossValidation.report.findings.map((finding) => finding.id));
    for (const withheld of slice.canonical.withheld) {
      expect(withheld.standing.findingIds.length).toBeGreaterThan(0);
      for (const findingId of withheld.standing.findingIds) {
        expect(findingIds.has(findingId)).toBe(true);
      }
    }
  });

  it("keeps graph edges internally consistent and refs anchored", () => {
    const graph = slice.knowledgeGraph.graph;
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.fromId), `edge ${edge.id} dangling from`).toBe(true);
      expect(nodeIds.has(edge.toId), `edge ${edge.id} dangling to`).toBe(true);
    }
    for (const node of graph.nodes) {
      expect(node.refs.length, `node ${node.id} has no refs`).toBeGreaterThan(0);
    }
  });

  it("anchors every graph fact node to a stated fact id", () => {
    const factNodes = slice.knowledgeGraph.graph.nodes.filter((node) => node.kind === "fact");
    expect(factNodes).toHaveLength(slice.extraction.facts.length);
    for (const node of factNodes) {
      const referenced = node.refs.some((ref) => ref.factId && factIds.has(ref.factId));
      expect(referenced, `fact node ${node.id} does not reference a stated fact`).toBe(true);
    }
  });

  it("backs every readiness evaluation reference with a known fact or source", () => {
    for (const evaluation of slice.readiness.report.evaluations) {
      for (const reference of evaluation.references) {
        if (reference.factId) expect(factIds.has(reference.factId)).toBe(true);
        if (reference.sourceId) expect(sourceIds.has(reference.sourceId)).toBe(true);
      }
    }
  });

  it("supports met readiness verdicts with at least one reference", () => {
    for (const evaluation of slice.readiness.report.evaluations) {
      if (evaluation.verdict === "met" && evaluation.requirement.kind !== "field_uncontested") {
        expect(
          evaluation.references.length,
          `met evaluation ${evaluation.id} cites nothing`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
