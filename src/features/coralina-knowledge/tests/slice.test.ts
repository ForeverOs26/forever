import { describe, expect, it } from "vitest";

import { findCrossValidationAssessment } from "@/features/forever-cross-validation";
import { findProjectField } from "@/features/forever-project-database";
import {
  findKnowledgeNode,
  listKnowledgeClaims,
  listKnowledgeEdgesByKind,
} from "@/features/forever-knowledge-graph";
import { listReadinessBlockers } from "@/features/forever-project-readiness";

import { buildCoralinaKnowledgeSlice } from "../slice";

const slice = buildCoralinaKnowledgeSlice();

describe("Coralina RC5.0 end-to-end chain", () => {
  it("runs every foundation stage successfully", () => {
    expect(slice.sources.validations.every((validation) => validation.issues.length === 0)).toBe(
      true,
    );
    expect(slice.extraction.validation.valid).toBe(true);
    expect(slice.extraction.plans.every((plan) => plan.ok)).toBe(true);
    expect(slice.crossValidation.result.ok).toBe(true);
    expect(slice.canonical.mergeResult.ok).toBe(true);
    expect(slice.knowledgeGraph.result.ok).toBe(true);
    expect(slice.readiness.result.ok).toBe(true);
  });

  it("plans extraction for each registered source through the RC4.5 pipeline", () => {
    expect(slice.extraction.plans).toHaveLength(8);
    const plannedSources = slice.extraction.plans.map((plan) => plan.metadata.sourceId);
    expect(plannedSources).toEqual(slice.sources.definitions.map((s) => s.identity.id));
  });

  it("judges the buildings corroborated across two independent sources", () => {
    const assessment = findCrossValidationAssessment(
      slice.crossValidation.report,
      "proj_coralina:inventory:units.buildings",
    );
    expect(assessment?.consensus).toBe("corroborated");
    expect(new Set(assessment?.readings.map((reading) => reading.sourceId)).size).toBe(2);
  });

  it("judges the unit-type vocabulary contested and withholds it from the record", () => {
    const assessment = findCrossValidationAssessment(
      slice.crossValidation.report,
      "proj_coralina:unit_type:units.unitTypes",
    );
    expect(assessment?.consensus).toBe("contested");
    const withheldPaths = slice.canonical.withheld.map((entry) => entry.fieldPath);
    expect(withheldPaths).toContain("units.unitTypes");
    expect(findProjectField(slice.canonical.record, "units.unitTypes")).toBeUndefined();
  });

  it("assesses every declared-missing path as unaddressed", () => {
    for (const gap of slice.gaps) {
      const assessment = findCrossValidationAssessment(
        slice.crossValidation.report,
        `proj_coralina:unknown:${gap.path}`,
      );
      expect(assessment?.consensus, gap.path).toBe("unaddressed");
      expect(assessment?.readings).toEqual([]);
    }
  });

  it("settles every admitted fact into the canonical record without silent conflicts", () => {
    expect(slice.canonical.merge.conflicts).toEqual([]);
    const rejected = slice.canonical.merge.entries.filter((entry) => entry.kind === "rejected");
    expect(rejected).toEqual([]);
    expect(slice.canonical.admittedFactIds).toHaveLength(17);
    expect(slice.canonical.record.fields).toHaveLength(16);
    expect(slice.canonical.merge.entries.filter((e) => e.kind === "added")).toHaveLength(16);
    expect(slice.canonical.merge.entries.filter((e) => e.kind === "unchanged")).toHaveLength(1);
  });

  it("keeps the canonical record valid, revisioned, and snapshotted", () => {
    const errors = slice.canonical.recordIssues.filter((issue) => issue.severity === "error");
    expect(errors).toEqual([]);
    expect(slice.canonical.record.revisions).toHaveLength(1);
    expect(slice.canonical.record.snapshots).toHaveLength(1);
    expect(slice.canonical.record.timeline.events.map((event) => event.kind)).toEqual([
      "created",
      "merge",
      "revision",
      "snapshot",
    ]);
  });

  it("builds a knowledge graph that keeps the dispute visible", () => {
    const graph = slice.knowledgeGraph.graph;
    expect(findKnowledgeNode(graph, "project", "coralina")).toBeDefined();
    const disputedClaims = listKnowledgeClaims(graph, "proj_coralina:unit_type:units.unitTypes");
    expect(disputedClaims).toHaveLength(2);
    for (const claim of disputedClaims) {
      expect(claim.standing).toBe("disputed");
    }
    expect(listKnowledgeEdgesByKind(graph, "contradicts").length).toBeGreaterThanOrEqual(1);
  });

  it("grounds the declared location and amenity entities in stated facts", () => {
    const graph = slice.knowledgeGraph.graph;
    expect(findKnowledgeNode(graph, "location", "kamala")).toBeDefined();
    expect(listKnowledgeEdgesByKind(graph, "located_in")).toHaveLength(1);
    expect(listKnowledgeEdgesByKind(graph, "offers")).toHaveLength(5);
    expect(graph.nodes.filter((node) => node.kind === "developer")).toHaveLength(1);
    expect(listKnowledgeEdgesByKind(graph, "developed_by")).toHaveLength(1);
  });

  it("derives readiness READY after official evidence resolves both blockers", () => {
    expect(slice.readiness.report.standing).toBe("ready");
    const blockers = listReadinessBlockers(slice.readiness.report);
    expect(blockers).toEqual([]);
  });

  it("meets the source and identity requirements that the committed data satisfies", () => {
    const byKindAndSubject = new Map(
      slice.readiness.report.evaluations.map((evaluation) => [
        `${evaluation.requirement.kind}:${evaluation.requirement.path ?? evaluation.requirement.documentType ?? ""}`,
        evaluation,
      ]),
    );
    expect(byKindAndSubject.get("source_present:brochure")?.verdict).toBe("met");
    expect(byKindAndSubject.get("source_present:price_list")?.verdict).toBe("met");
    expect(byKindAndSubject.get("field_present:general.name")?.verdict).toBe("met");
    expect(byKindAndSubject.get("field_confidence:general.name")?.verdict).toBe("met");
    expect(byKindAndSubject.get("field_corroborated:units.buildings")?.verdict).toBe("met");
    // The disputed vocabulary must NOT read as ready.
    expect(byKindAndSubject.get("field_uncontested:units.unitTypes")?.verdict).toBe("unmet");
    expect(byKindAndSubject.get("field_present:units.unitTypes")?.verdict).toBe("unmet");
    expect(byKindAndSubject.get("findings_clear:")?.verdict).toBe("unmet");
  });
});
