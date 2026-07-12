import { describe, expect, it } from "vitest";

import { normalizeProjectSourceSlug } from "@/features/forever-project-sources";
import { projectCanonicalId } from "@/features/forever-project-template";

import {
  EXTRACTION_ID_PREFIXES,
  deriveExtractionIdentity,
  extractionFactIdFor,
  extractionIdForSlug,
  extractionPlanIdFor,
  extractionProjectId,
  extractionVersion,
  normalizeExtractionSlug,
} from "..";

describe("extraction identity", () => {
  it("derives deterministic, byte-identical identities from a slug", () => {
    expect(deriveExtractionIdentity("forever-extraction")).toEqual(
      deriveExtractionIdentity("forever-extraction"),
    );
    expect(deriveExtractionIdentity("Forever Extraction!")).toEqual({
      id: "extr_forever-extraction",
      slug: "forever-extraction",
      name: "forever-extraction",
    });
    expect(deriveExtractionIdentity("forever-extraction", { name: "Named" }).name).toBe("Named");
  });

  it("derives ids through the module's own prefix rules", () => {
    expect(extractionIdForSlug("forever-extraction")).toBe(
      `${EXTRACTION_ID_PREFIXES.definition}forever-extraction`,
    );
    expect(extractionPlanIdFor("proj_coralina", "price-list")).toBe(
      "xplan_proj-coralina-price-list",
    );
    expect(extractionFactIdFor("coralina", "price-1br")).toBe("xfact_coralina-price-1br");
  });

  it("is source-version-aware: the revision participates in plan and fact ids", () => {
    const v1 = extractionVersion(1, 0, 0);
    const v2 = extractionVersion(2, 0, 0);
    expect(extractionPlanIdFor("proj_coralina", "price-list", v1)).toBe(
      "xplan_proj-coralina-price-list-v1-0-0",
    );
    expect(extractionPlanIdFor("proj_coralina", "price-list", v1)).not.toBe(
      extractionPlanIdFor("proj_coralina", "price-list", v2),
    );
    expect(extractionFactIdFor("coralina", "price-1br", v1)).toBe(
      "xfact_coralina-price-1br-v1-0-0",
    );
    expect(extractionFactIdFor("coralina", "price-1br", v1)).not.toBe(
      extractionFactIdFor("coralina", "price-1br", v2),
    );
  });

  it("is blind to the version label, exactly like the RC4.4 id rule it mirrors", () => {
    const draft = { ...extractionVersion(1, 0, 0), label: "draft" };
    const final = { ...extractionVersion(1, 0, 0), label: "final" };
    expect(extractionPlanIdFor("proj_coralina", "price-list", draft)).toBe(
      extractionPlanIdFor("proj_coralina", "price-list", final),
    );
    expect(extractionFactIdFor("coralina", "price-1br", draft)).toBe(
      "xfact_coralina-price-1br-v1-0-0",
    );
  });

  it("avoids the fact_ prefix already taken by RC4.3 factories", () => {
    expect(EXTRACTION_ID_PREFIXES.fact).not.toBe("fact_");
    expect(extractionFactIdFor("coralina", "x").startsWith("fact_")).toBe(false);
  });

  it("reuses the RC4.4 slug rule and the RC4.2 project-id convention verbatim", () => {
    expect(normalizeExtractionSlug).toBe(normalizeProjectSourceSlug);
    expect(extractionProjectId).toBe(projectCanonicalId);
    expect(extractionProjectId("coralina")).toBe("proj_coralina");
  });
});
