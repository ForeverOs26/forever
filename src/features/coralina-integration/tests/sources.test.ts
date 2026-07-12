import { validateSourceDefinition } from "@/features/forever-source-registry";
import { describe, expect, it } from "vitest";

import { CORALINA_SOURCE_DEFINITIONS, CORALINA_SOURCE_DEFINITIONS_BY_ID } from "../sources";
import { CORALINA_BROCHURE_SOURCE_ID, CORALINA_PRICE_LIST_SOURCE_ID } from "../identity";

describe("Coralina source definitions (RC3.3)", () => {
  it("registers one source per verified artifact and nothing more", () => {
    const ids = CORALINA_SOURCE_DEFINITIONS.map((s) => s.identity.id);
    expect(ids).toContain(CORALINA_BROCHURE_SOURCE_ID);
    expect(ids).toContain(CORALINA_PRICE_LIST_SOURCE_ID);
    // No developer-information or construction-information source: Coralina has none.
    expect(ids.some((id) => id.includes("developer_info"))).toBe(false);
    expect(ids.some((id) => id.includes("construction"))).toBe(false);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every source definition passes RC3.3 validation with no errors", () => {
    for (const definition of CORALINA_SOURCE_DEFINITIONS) {
      const errors = validateSourceDefinition(definition).filter((i) => i.severity === "error");
      expect(errors).toEqual([]);
    }
  });

  it("classifies image-only collections honestly as unknown, not a false format", () => {
    const unitPlans = CORALINA_SOURCE_DEFINITIONS_BY_ID.get("src_coralina_unit_plans");
    expect(unitPlans?.identity.type).toBe("unknown");
    // ...while PDFs are typed pdf.
    const brochure = CORALINA_SOURCE_DEFINITIONS_BY_ID.get(CORALINA_BROCHURE_SOURCE_ID);
    expect(brochure?.identity.type).toBe("pdf");
  });

  it("declares only canonical import entity kinds", () => {
    const allowed = new Set(["project", "developer", "document", "media"]);
    for (const definition of CORALINA_SOURCE_DEFINITIONS) {
      expect(definition.supportedEntities.length).toBeGreaterThan(0);
      for (const kind of definition.supportedEntities) expect(allowed.has(kind)).toBe(true);
    }
  });
});
