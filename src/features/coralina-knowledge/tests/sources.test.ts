import { describe, expect, it } from "vitest";

import { validateProjectSourceDefinition } from "@/features/forever-project-sources";

import {
  buildCoralinaKnowledgeSourceRegistry,
  CORALINA_BROCHURE_SOURCE,
  CORALINA_KNOWLEDGE_SOURCES,
  CORALINA_PRICE_LIST_SOURCE,
} from "../sources";

describe("Coralina RC4.4 sources", () => {
  it("registers exactly the six committed source artifacts", () => {
    expect(CORALINA_KNOWLEDGE_SOURCES).toHaveLength(6);
    expect(CORALINA_KNOWLEDGE_SOURCES.map((source) => source.identity.id)).toEqual([
      "psrc_coralina-brochure-v1-0-0",
      "psrc_coralina-price-list-v2-0-0",
      "psrc_coralina-facilities-v1-0-0",
      "psrc_coralina-location-map-v1-0-0",
      "psrc_coralina-unit-plans-v1-0-0",
      "psrc_coralina-master-plan-v1-0-0",
    ]);
  });

  it("produces definitions that pass RC4.4 validation with zero issues", () => {
    for (const source of CORALINA_KNOWLEDGE_SOURCES) {
      expect(validateProjectSourceDefinition(source)).toEqual([]);
    }
  });

  it("scopes every source to the Coralina project", () => {
    for (const source of CORALINA_KNOWLEDGE_SOURCES) {
      expect(source.identity.projectId).toBe("proj_coralina");
    }
  });

  it("registers the price list at the artifact's own stated version (V.2)", () => {
    expect(CORALINA_PRICE_LIST_SOURCE.version).toMatchObject({ major: 2, minor: 0, patch: 0 });
    expect(CORALINA_PRICE_LIST_SOURCE.descriptor.documentDate).toBe("2026-07-03");
  });

  it("cites the committed artifact path for every source", () => {
    for (const source of CORALINA_KNOWLEDGE_SOURCES) {
      expect(source.metadata?.description).toContain("forever-data/projects/coralina/source/");
    }
  });

  it("mirrors the repository's existing trust judgement", () => {
    expect(CORALINA_BROCHURE_SOURCE.authority.trust).toBe("high");
    expect(CORALINA_PRICE_LIST_SOURCE.authority.trust).toBe("high");
    const supporting = CORALINA_KNOWLEDGE_SOURCES.filter(
      (source) => source !== CORALINA_BROCHURE_SOURCE && source !== CORALINA_PRICE_LIST_SOURCE,
    );
    for (const source of supporting) {
      expect(source.authority.trust).toBe("standard");
    }
  });

  it("builds a registry that resolves every source by id", () => {
    const registry = buildCoralinaKnowledgeSourceRegistry();
    expect(registry.list()).toHaveLength(6);
    for (const source of CORALINA_KNOWLEDGE_SOURCES) {
      expect(registry.resolve(source.identity.id)).toEqual(source);
    }
    expect(registry.listByProject("proj_coralina")).toHaveLength(6);
  });

  it("registers no source for material Coralina does not have", () => {
    const documentTypes = CORALINA_KNOWLEDGE_SOURCES.map(
      (source) => source.descriptor.documentType,
    );
    // No legal, contract, payment-plan, or developer-update source exists in
    // the committed package, so none may be registered.
    expect(documentTypes).not.toContain("legal_document");
    expect(documentTypes).not.toContain("contract");
    expect(documentTypes).not.toContain("payment_plan");
    expect(documentTypes).not.toContain("developer_update");
  });
});
