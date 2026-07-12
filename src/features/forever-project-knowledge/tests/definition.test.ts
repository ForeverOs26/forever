import { describe, expect, it } from "vitest";

import { MODEVA_KNOWLEDGE_DEFINITION } from "@/features/modeva-knowledge";

import { validateProjectKnowledgeDefinition, type ProjectKnowledgeDefinition } from "../definition";

function cloneDefinition(): ProjectKnowledgeDefinition {
  // The definition is plain serialisable data — that is the point of RC5.1 —
  // so structuredClone yields an independent, mutable copy for negative tests.
  return structuredClone(MODEVA_KNOWLEDGE_DEFINITION) as ProjectKnowledgeDefinition;
}

describe("validateProjectKnowledgeDefinition", () => {
  it("accepts a well-formed definition", () => {
    expect(validateProjectKnowledgeDefinition(MODEVA_KNOWLEDGE_DEFINITION)).toEqual([]);
  });

  it("reports a blank identity", () => {
    const definition = cloneDefinition();
    definition.identity = { ...definition.identity, projectSlug: " ", projectName: "" };
    const issues = validateProjectKnowledgeDefinition(definition);
    expect(issues.some((issue) => issue.path === "identity.projectSlug")).toBe(true);
    expect(issues.some((issue) => issue.path === "identity.projectName")).toBe(true);
  });

  it("reports a non-ISO described-at instant", () => {
    const definition = cloneDefinition();
    definition.identity = { ...definition.identity, describedAt: "not-a-date" };
    expect(
      validateProjectKnowledgeDefinition(definition).some(
        (issue) => issue.path === "identity.describedAt",
      ),
    ).toBe(true);
  });

  it("reports an empty source list", () => {
    const definition = cloneDefinition();
    definition.sources = [];
    expect(
      validateProjectKnowledgeDefinition(definition).some((issue) => issue.path === "sources"),
    ).toBe(true);
  });

  it("reports a source belonging to a different project", () => {
    const definition = cloneDefinition();
    definition.identity = { ...definition.identity, projectId: "proj_some-other-project" };
    const issues = validateProjectKnowledgeDefinition(definition);
    expect(issues.some((issue) => issue.path?.startsWith("sources["))).toBe(true);
    expect(issues.some((issue) => issue.path?.startsWith("facts["))).toBe(true);
  });

  it("reports a fact citing an unregistered source", () => {
    const definition = cloneDefinition();
    definition.sources = definition.sources.slice(0, 1);
    definition.planTargets = definition.planTargets.slice(0, 1);
    const issues = validateProjectKnowledgeDefinition(definition);
    expect(issues.some((issue) => issue.path?.startsWith("facts["))).toBe(true);
  });

  it("reports a plan target over an unregistered source and an empty fact-type list", () => {
    const definition = cloneDefinition();
    definition.planTargets = [
      { ...definition.planTargets[1]!, factTypes: [] },
      { ...definition.planTargets[0]! },
    ];
    definition.sources = definition.sources.slice(1);
    const issues = validateProjectKnowledgeDefinition(definition);
    expect(issues.some((issue) => issue.path?.endsWith(".factTypes"))).toBe(true);
    expect(issues.some((issue) => issue.path?.startsWith("planTargets["))).toBe(true);
  });

  it("reports a path both stated as a fact and declared missing (anti-fabrication)", () => {
    const definition = cloneDefinition();
    definition.gaps = [
      ...definition.gaps,
      { path: "general.name", reason: "contradicts the stated name fact" },
    ];
    expect(
      validateProjectKnowledgeDefinition(definition).some((issue) =>
        issue.message.includes("cannot be both"),
      ),
    ).toBe(true);
  });

  it("reports blank gap statements and provenance strings", () => {
    const definition = cloneDefinition();
    definition.gaps = [{ path: "", reason: " " }];
    definition.provenance = { mergeAuthor: "", mergeReason: " ", createdNote: "" };
    const issues = validateProjectKnowledgeDefinition(definition);
    expect(issues.some((issue) => issue.path === "gaps[0].path")).toBe(true);
    expect(issues.some((issue) => issue.path === "gaps[0].reason")).toBe(true);
    expect(issues.some((issue) => issue.path === "provenance.mergeAuthor")).toBe(true);
    expect(issues.some((issue) => issue.path === "provenance.mergeReason")).toBe(true);
    expect(issues.some((issue) => issue.path === "provenance.createdNote")).toBe(true);
  });
});
