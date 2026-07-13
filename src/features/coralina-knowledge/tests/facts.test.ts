import { describe, expect, it } from "vitest";

import {
  CORALINA_AREA,
  CORALINA_BEACH_DISTANCE,
  CORALINA_HIGHLIGHTS,
  CORALINA_PROJECT_NAME,
  CORALINA_PROJECT_TYPE,
  CORALINA_PROVINCE,
  CORALINA_UNIT_TYPES,
} from "@/features/coralina-integration";
import { crossSourceReadingSignature } from "@/features/forever-cross-validation";
import { validateExtractionFacts } from "@/features/forever-extraction-pipeline";

import {
  CORALINA_AREA_FACT,
  CORALINA_BEACH_DISTANCE_FACT,
  CORALINA_BUILDINGS_FACILITIES_FACT,
  CORALINA_BUILDINGS_UNIT_PLANS_FACT,
  CORALINA_EXPECTED_MISSING_PATHS,
  CORALINA_EXTRACTION_FACTS,
  CORALINA_NAME_FACT,
  CORALINA_PROJECT_TYPE_FACT,
  CORALINA_PROVINCE_FACT,
  CORALINA_UNIT_PLAN_TYPE_LABELS,
  CORALINA_UNIT_TYPES_PRICE_LIST_FACT,
  CORALINA_UNIT_TYPES_UNIT_PLANS_FACT,
} from "../facts";
import { CORALINA_KNOWLEDGE_SOURCES } from "../sources";

describe("Coralina RC4.5 extraction facts", () => {
  it("passes RC4.5 fact-set validation with zero issues", () => {
    const validation = validateExtractionFacts([...CORALINA_EXTRACTION_FACTS]);
    expect(validation.issues).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it("copies verified values verbatim from the committed data", () => {
    expect(CORALINA_NAME_FACT.rawValue).toBe(CORALINA_PROJECT_NAME.value);
    expect(CORALINA_PROJECT_TYPE_FACT.rawValue).toBe(CORALINA_PROJECT_TYPE.value);
    expect(CORALINA_AREA_FACT.rawValue).toBe(CORALINA_AREA.value);
    expect(CORALINA_PROVINCE_FACT.rawValue).toBe(CORALINA_PROVINCE.value);
    expect(CORALINA_BEACH_DISTANCE_FACT.rawValue).toBe(CORALINA_BEACH_DISTANCE.value);
    expect(CORALINA_UNIT_TYPES_PRICE_LIST_FACT.structuredValue).toEqual([...CORALINA_UNIT_TYPES]);
  });

  it("binds every amenity fact to its committed highlight by value, page, and confidence", () => {
    const highlightsByValue = new Map(
      CORALINA_HIGHLIGHTS.map((highlight) => [highlight.value, highlight]),
    );
    const amenityFacts = CORALINA_EXTRACTION_FACTS.filter((fact) => fact.factType === "amenity");
    expect(amenityFacts).toHaveLength(5);
    for (const fact of amenityFacts) {
      const highlight = highlightsByValue.get(fact.rawValue ?? "");
      expect(
        highlight,
        `amenity fact ${fact.id} does not match a committed highlight`,
      ).toBeDefined();
      expect(fact.confidence.level).toBe(highlight?.confidence);
      expect(fact.evidence.locator?.page ?? null).toBe(highlight?.page ?? null);
    }
  });

  it("carries the committed confidence levels and invents no scores", () => {
    for (const fact of CORALINA_EXTRACTION_FACTS) {
      expect(["high", "medium"]).toContain(fact.confidence.level);
      expect(fact.confidence.score).toBeUndefined();
    }
  });

  it("references only registered Coralina sources, with matching versions", () => {
    const sourcesById = new Map(
      CORALINA_KNOWLEDGE_SOURCES.map((source) => [source.identity.id, source]),
    );
    for (const fact of CORALINA_EXTRACTION_FACTS) {
      const source = sourcesById.get(fact.sourceId);
      expect(source, `${fact.id} references unregistered source ${fact.sourceId}`).toBeDefined();
      expect(fact.sourceVersion).toEqual(source?.version);
      expect(fact.evidence.sourceId).toBe(fact.sourceId);
      expect(fact.provenance.sourceId).toBe(fact.sourceId);
      expect(fact.projectId).toBe("proj_coralina");
    }
  });

  it("gives every fact evidence with an excerpt or locator", () => {
    for (const fact of CORALINA_EXTRACTION_FACTS) {
      expect(fact.evidence.locator ?? fact.evidence.excerpt).toBeDefined();
    }
  });

  it("states the buildings identically from two independent sources (real corroboration)", () => {
    expect(crossSourceReadingSignature(CORALINA_BUILDINGS_FACILITIES_FACT)).toBe(
      crossSourceReadingSignature(CORALINA_BUILDINGS_UNIT_PLANS_FACT),
    );
    expect(CORALINA_BUILDINGS_FACILITIES_FACT.sourceId).not.toBe(
      CORALINA_BUILDINGS_UNIT_PLANS_FACT.sourceId,
    );
  });

  it("preserves the real unit-type disagreement between price list and unit plans", () => {
    expect(crossSourceReadingSignature(CORALINA_UNIT_TYPES_PRICE_LIST_FACT)).not.toBe(
      crossSourceReadingSignature(CORALINA_UNIT_TYPES_UNIT_PLANS_FACT),
    );
    // The floor plans state a "1 Bedroom S" the price list never mentions.
    expect(CORALINA_UNIT_PLAN_TYPE_LABELS).toContain("1 Bedroom S");
    expect(CORALINA_UNIT_TYPES).not.toContain("1 BEDROOM S");
  });

  it("states no fact for any path the sources do not address", () => {
    const statedPaths = new Set(CORALINA_EXTRACTION_FACTS.map((fact) => fact.fieldPath));
    for (const gap of CORALINA_EXPECTED_MISSING_PATHS) {
      expect(statedPaths.has(gap.path), `fabricated fact for missing path ${gap.path}`).toBe(false);
    }
  });

  it("declares the remaining gaps for coordinates, status, tenure, and currency", () => {
    expect(CORALINA_EXPECTED_MISSING_PATHS.map((gap) => gap.path)).toEqual([
      "location.coordinates",
      "construction.status",
      "legal.ownershipType",
      "pricing.currency",
    ]);
  });
});
