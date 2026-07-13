import { describe, expect, it } from "vitest";

import { validateProjectSourceDefinition } from "@/features/forever-project-sources";

import {
  buildCoralinaKnowledgeSourceRegistry,
  CORALINA_BROCHURE_SOURCE,
  CORALINA_KNOWLEDGE_SOURCES,
  CORALINA_PRICE_LIST_SOURCE,
} from "../sources";

describe("Coralina RC4.4 sources", () => {
  it("registers six local artifacts and two official web sources", () => {
    expect(CORALINA_KNOWLEDGE_SOURCES).toHaveLength(8);
    expect(CORALINA_KNOWLEDGE_SOURCES.map((source) => source.identity.id)).toEqual([
      "psrc_coralina-brochure-v1-0-0",
      "psrc_coralina-price-list-v2-0-0",
      "psrc_coralina-facilities-v1-0-0",
      "psrc_coralina-location-map-v1-0-0",
      "psrc_coralina-unit-plans-v1-0-0",
      "psrc_coralina-master-plan-v1-0-0",
      "psrc_coralina-official-corporate-history-v1-0-0",
      "psrc_coralina-official-sec-q1-2026-filing-v1-0-0",
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

  it("cites either a committed artifact path or official URL for every source", () => {
    for (const source of CORALINA_KNOWLEDGE_SOURCES) {
      expect(source.metadata?.description).toMatch(
        /^(forever-data\/projects\/coralina\/source\/|https:\/\/)/,
      );
    }
  });

  it("mirrors the repository's existing trust judgement", () => {
    expect(CORALINA_BROCHURE_SOURCE.authority.trust).toBe("high");
    expect(CORALINA_PRICE_LIST_SOURCE.authority.trust).toBe("high");
    const supporting = CORALINA_KNOWLEDGE_SOURCES.slice(2, 6).filter(
      (source) => source !== CORALINA_BROCHURE_SOURCE && source !== CORALINA_PRICE_LIST_SOURCE,
    );
    for (const source of supporting) {
      expect(source.authority.trust).toBe("standard");
    }
  });

  it("builds a registry that resolves every source by id", () => {
    const registry = buildCoralinaKnowledgeSourceRegistry();
    expect(registry.list()).toHaveLength(8);
    for (const source of CORALINA_KNOWLEDGE_SOURCES) {
      expect(registry.resolve(source.identity.id)).toEqual(source);
    }
    expect(registry.listByProject("proj_coralina")).toHaveLength(8);
  });

  it("registers official developer and legal sources but no unsupported contract or payment plan", () => {
    const documentTypes = CORALINA_KNOWLEDGE_SOURCES.map(
      (source) => source.descriptor.documentType,
    );
    expect(documentTypes).toContain("legal_document");
    expect(documentTypes).not.toContain("contract");
    expect(documentTypes).not.toContain("payment_plan");
    expect(documentTypes).toContain("developer_update");
  });
});
