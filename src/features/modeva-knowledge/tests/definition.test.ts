import { describe, expect, it } from "vitest";

import { validateProjectKnowledgeDefinition } from "@/features/forever-project-knowledge";

import { MODEVA_KNOWLEDGE_DEFINITION } from "../definition";
import { MODEVA_EXPECTED_MISSING_PATHS, MODEVA_EXTRACTION_FACTS } from "../facts";
import { MODEVA_KNOWLEDGE_SOURCES } from "../sources";

describe("Modeva knowledge definition", () => {
  it("is structurally valid", () => {
    expect(validateProjectKnowledgeDefinition(MODEVA_KNOWLEDGE_DEFINITION)).toEqual([]);
  });

  it("states every fact against a registered source", () => {
    const sourceIds = new Set(MODEVA_KNOWLEDGE_SOURCES.map((source) => source.identity.id));
    for (const fact of MODEVA_EXTRACTION_FACTS) {
      expect(sourceIds.has(fact.sourceId)).toBe(true);
    }
  });

  it("never states a fact for a declared gap (anti-fabrication)", () => {
    const statedPaths = new Set(MODEVA_EXTRACTION_FACTS.map((fact) => fact.fieldPath));
    for (const gap of MODEVA_EXPECTED_MISSING_PATHS) {
      expect(statedPaths.has(gap.path)).toBe(false);
    }
  });

  it("declares no manifest blockers — Modeva has no committed manifest", () => {
    expect(MODEVA_EXPECTED_MISSING_PATHS.every((gap) => !gap.manifestBlocker)).toBe(true);
  });

  it("grounds every graph declaration in a stated fact", () => {
    const factIds = new Set(MODEVA_EXTRACTION_FACTS.map((fact) => fact.id));
    for (const entity of MODEVA_KNOWLEDGE_DEFINITION.entities) {
      for (const ref of entity.refs) expect(factIds.has(ref.factId ?? "")).toBe(true);
    }
    for (const relation of MODEVA_KNOWLEDGE_DEFINITION.relations) {
      for (const ref of relation.refs) expect(factIds.has(ref.factId ?? "")).toBe(true);
    }
  });

  it("states the confidence policy: seed facts medium, reviewed-import and run facts high", () => {
    const bySource = new Map(
      MODEVA_KNOWLEDGE_SOURCES.map((source) => [source.identity.id, source]),
    );
    for (const fact of MODEVA_EXTRACTION_FACTS) {
      const source = bySource.get(fact.sourceId)!;
      if (source.identity.name.includes("Canonical Seed")) {
        expect(fact.confidence.level).toBe("medium");
      } else {
        expect(fact.confidence.level).toBe("high");
      }
    }
  });
});
