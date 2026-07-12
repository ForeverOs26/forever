import { describe, expect, it } from "vitest";

import {
  describeExtractionFact,
  distinctExtractionDocumentTypes,
  distinctExtractionFactTypes,
  extractionDefinitionKey,
  extractionRecipeStepFactTypes,
  extractionStageCount,
  extractionStepCount,
  extractionStep,
  extractionVersion,
  groupExtractionFactsBySubject,
  listConflictingExtractionFactGroups,
  listExtractionFactsBySource,
  listExtractionFactsByType,
  listExtractionFactsForProject,
  sortExtractionFacts,
  sortExtractionFactsBySourceVersion,
} from "..";
import { makeDefinition, makeFactInput } from "./fixtures";

const CRM_SOURCE = "psrc_coralina-crm-export-v1-0-0";

/** The same price subject read out of the CRM export instead of the PDF. */
function crmPriceInput() {
  return makeFactInput({
    factSlug: "price-1br-crm",
    sourceId: CRM_SOURCE,
    rawValue: "4,650,000 THB",
    structuredValue: { amount: 4650000, currency: "THB" },
    locator: { kind: "sheet", sheet: "Units" },
    excerpt: "1BR;4650000;THB",
  });
}

describe("structural helpers", () => {
  it("keys definitions by slug and counts stages and steps across recipes", () => {
    const definition = makeDefinition();
    expect(extractionDefinitionKey(definition)).toBe("forever-extraction");
    expect(extractionStageCount(definition)).toBe(4);
    expect(extractionStepCount(definition)).toBe(9);
  });

  it("collects distinct document types and step fact types in first-seen order", () => {
    const definition = makeDefinition();
    expect(distinctExtractionDocumentTypes(definition)).toEqual([]);
    definition.recipes[0].documentTypes = ["price_list", "brochure"];
    expect(distinctExtractionDocumentTypes(definition)).toEqual(["price_list", "brochure"]);

    const recipe = definition.recipes[0];
    recipe.stages[1].steps.push(
      extractionStep("describe-prices", "Describe the prices", "extract", {
        factTypes: ["price", "currency"],
      }),
      extractionStep("describe-areas", "Describe the areas", "extract", {
        factTypes: ["price", "internal_area"],
      }),
    );
    expect(extractionRecipeStepFactTypes(recipe)).toEqual(["price", "currency", "internal_area"]);
  });
});

describe("fact collection helpers", () => {
  it("lets one source produce many facts and filters by source, type, and project", () => {
    const price = describeExtractionFact(makeFactInput());
    const bedrooms = describeExtractionFact(
      makeFactInput({ factSlug: "bedrooms-1br", factType: "bedrooms", rawValue: "1" }),
    );
    const crmPrice = describeExtractionFact(crmPriceInput());
    const facts = [price, bedrooms, crmPrice];

    expect(listExtractionFactsBySource(facts, price.sourceId)).toEqual([price, bedrooms]);
    expect(listExtractionFactsByType(facts, "price")).toEqual([price, crmPrice]);
    expect(listExtractionFactsForProject(facts, "proj_coralina")).toEqual(facts);
    expect(distinctExtractionFactTypes(facts)).toEqual(["price", "bedrooms"]);
  });

  it("groups readings of one subject from multiple sources without resolving them", () => {
    const price = describeExtractionFact(makeFactInput());
    const crmPrice = describeExtractionFact(crmPriceInput());
    const groups = groupExtractionFactsBySubject([price, crmPrice]);
    expect(groups).toHaveLength(1);
    expect(groups[0].subject).toBe("proj_coralina:price:pricing.basePrice");
    expect(groups[0].facts).toEqual([price, crmPrice]);
  });

  it("describes conflicting readings and ignores superseded and unavailable ones", () => {
    const price = describeExtractionFact(makeFactInput());
    const crmPrice = describeExtractionFact(crmPriceInput());
    expect(listConflictingExtractionFactGroups([price, crmPrice])).toHaveLength(1);

    const agreeing = describeExtractionFact(crmPriceInput());
    agreeing.rawValue = price.rawValue;
    agreeing.structuredValue = price.structuredValue;
    expect(listConflictingExtractionFactGroups([price, agreeing])).toEqual([]);

    const retired = describeExtractionFact(crmPriceInput());
    retired.status = "superseded";
    retired.supersededBy = price.id;
    expect(listConflictingExtractionFactGroups([price, retired])).toEqual([]);
  });

  it("sorts facts by the one canonical order, stably and immutably", () => {
    const price = describeExtractionFact(makeFactInput());
    const crmPrice = describeExtractionFact(crmPriceInput());
    const bedrooms = describeExtractionFact(
      makeFactInput({ factSlug: "bedrooms-1br", factType: "bedrooms", rawValue: "1" }),
    );
    const facts = [price, crmPrice, bedrooms];
    const sorted = sortExtractionFacts(facts);
    // bedrooms ranks before price canonically; the tied prices order by source id.
    expect(sorted).toEqual([bedrooms, crmPrice, price]);
    expect(facts).toEqual([price, crmPrice, bedrooms]);
  });

  it("orders facts oldest source revision first through the reused comparison", () => {
    const v1 = describeExtractionFact(makeFactInput());
    const v2 = describeExtractionFact(makeFactInput({ sourceVersion: extractionVersion(2, 0, 0) }));
    expect(sortExtractionFactsBySourceVersion([v2, v1])).toEqual([v1, v2]);
  });

  it("orders the revision tier numerically, not lexicographically: 1.2.0 before 1.10.0", () => {
    const v2 = describeExtractionFact(makeFactInput({ sourceVersion: extractionVersion(1, 2, 0) }));
    const v10 = describeExtractionFact(
      makeFactInput({ sourceVersion: extractionVersion(1, 10, 0) }),
    );
    expect(sortExtractionFacts([v10, v2])).toEqual([v2, v10]);
    expect(sortExtractionFactsBySourceVersion([v10, v2])).toEqual([v2, v10]);
  });

  it("keeps fully tied facts in input order (stable sort)", () => {
    const first = describeExtractionFact(makeFactInput());
    const second = describeExtractionFact(makeFactInput({ excerpt: "same subject, same id" }));
    expect(sortExtractionFacts([first, second])).toEqual([first, second]);
    expect(sortExtractionFacts([second, first])).toEqual([second, first]);
  });

  it("groups multiple subjects in first-seen order", () => {
    const price = describeExtractionFact(makeFactInput());
    const bedrooms = describeExtractionFact(
      makeFactInput({ factSlug: "bedrooms-1br", factType: "bedrooms", rawValue: "1" }),
    );
    const crmPrice = describeExtractionFact(crmPriceInput());
    const groups = groupExtractionFactsBySubject([price, bedrooms, crmPrice]);
    expect(groups.map((group) => group.subject)).toEqual([
      "proj_coralina:price:pricing.basePrice",
      "proj_coralina:bedrooms:pricing.basePrice",
    ]);
    expect(groups[0].facts).toEqual([price, crmPrice]);
  });
});
