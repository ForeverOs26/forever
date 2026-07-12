import { describe, expect, it } from "vitest";

import {
  buildProjectKnowledgeSlice,
  describeProjectKnowledgeInspection,
} from "@/features/forever-project-knowledge";

import { MODEVA_KNOWLEDGE_DEFINITION } from "../definition";
import { MODEVA_EXPECTED_MISSING_PATHS, MODEVA_EXTRACTION_FACTS } from "../facts";

const slice = buildProjectKnowledgeSlice(MODEVA_KNOWLEDGE_DEFINITION);
const inspection = describeProjectKnowledgeInspection(slice, MODEVA_KNOWLEDGE_DEFINITION.copy);

describe("Modeva RC4.4→RC4.9 chain through the RC5.1 engine", () => {
  it("registers the three committed artifacts with no validation issues", () => {
    expect(slice.sources.definitions).toHaveLength(3);
    expect(slice.sources.validations.every((validation) => validation.issues.length === 0)).toBe(
      true,
    );
  });

  it("plans extraction and validates every stated fact", () => {
    expect(slice.extraction.plans.every((plan) => plan.ok)).toBe(true);
    expect(slice.extraction.validation.valid).toBe(true);
    expect(slice.extraction.facts).toHaveLength(MODEVA_EXTRACTION_FACTS.length);
  });

  it("corroborates exactly the subjects two artifacts independently state", () => {
    const consensusByPath = new Map(
      slice.crossValidation.report.subjects.map((subject) => [
        subject.subject.fieldPath,
        subject.consensus,
      ]),
    );
    expect(consensusByPath.get("general.name")).toBe("corroborated");
    expect(consensusByPath.get("developer.name")).toBe("corroborated");
    expect(consensusByPath.get("location.area")).toBe("corroborated");
    // Single-artifact subjects stay uncorroborated — agreement is never invented.
    expect(consensusByPath.get("location.country")).toBe("uncorroborated");
    expect(consensusByPath.get("units.unitTypes")).toBe("uncorroborated");
  });

  it("has no disputes and withholds nothing — every statement is admitted", () => {
    expect(inspection.disputes).toHaveLength(0);
    expect(slice.canonical.withheld).toHaveLength(0);
    expect(slice.canonical.admittedFactIds).toHaveLength(MODEVA_EXTRACTION_FACTS.length);
    expect(slice.canonical.merge.conflicts).toHaveLength(0);
    expect(slice.canonical.recordIssues).toEqual([]);
  });

  it("reports every declared gap as an explicit missing_information finding", () => {
    const missingFindings = slice.crossValidation.report.findings.filter(
      (finding) => finding.kind === "missing_information",
    );
    expect(missingFindings).toHaveLength(MODEVA_EXPECTED_MISSING_PATHS.length);
    expect(inspection.missing.every((row) => row.findingIds.length > 0)).toBe(true);
  });

  it("judges readiness BLOCKED on the missing brochure — live in product, below intake bar", () => {
    expect(slice.readiness.report.standing).toBe("blocked");
    expect(inspection.readiness.blockers).toHaveLength(1);
    expect(inspection.readiness.blockers[0]!.kind).toBe("source_present");
    expect(inspection.readiness.blockers[0]!.subject).toBe("brochure");
  });

  it("meets the two fields that block Coralina — developer and country are stated", () => {
    const verdictBySubject = new Map(
      inspection.readiness.evaluations.map((row) => [`${row.kind}:${row.subject}`, row.verdict]),
    );
    expect(verdictBySubject.get("field_present:developer.name")).toBe("met");
    expect(verdictBySubject.get("field_present:location.country")).toBe("met");
  });

  it("builds a knowledge graph with the declared developer and location entities", () => {
    expect(slice.knowledgeGraph.result.ok).toBe(true);
    const keys = slice.knowledgeGraph.graph.nodes.map((node) => `${node.kind}:${node.key}`);
    expect(keys).toContain("developer:title");
    expect(keys).toContain("location:bang-tao");
    expect(keys).toContain("project:modeva");
  });

  it("is deterministic — building the definition twice yields deep-equal slices", () => {
    expect(buildProjectKnowledgeSlice(MODEVA_KNOWLEDGE_DEFINITION)).toEqual(slice);
  });

  it("derives the project name from the canonical record and stays serialisable", () => {
    expect(inspection.projectName).toBe("Modeva");
    expect(inspection.projectId).toBe("proj_modeva");
    expect(JSON.parse(JSON.stringify(inspection))).toEqual(inspection);
  });
});
