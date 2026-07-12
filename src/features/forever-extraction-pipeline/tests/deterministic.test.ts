import { describe, expect, it } from "vitest";

import {
  addExtractionCatalogEntry,
  buildForeverExtractionPipeline,
  describeExtractionFact,
  foreverExtractionRecipe,
  planExtraction,
  sortExtractionFacts,
  validateExtractionCatalog,
  validateExtractionFacts,
} from "..";
import {
  makeCatalog,
  makeContext,
  makeEntry,
  makeFact,
  makeFactInput,
  makeRequest,
} from "./fixtures";

describe("deterministic foundation", () => {
  it("canonical pipeline and recipe are pure: equal, independent values per call", () => {
    expect(buildForeverExtractionPipeline()).toEqual(buildForeverExtractionPipeline());
    expect(foreverExtractionRecipe()).toEqual(foreverExtractionRecipe());

    const mutated = buildForeverExtractionPipeline();
    mutated.recipes.pop();
    mutated.factTypes.pop();
    expect(buildForeverExtractionPipeline().recipes).toHaveLength(1);
    expect(buildForeverExtractionPipeline().factTypes).toContain("inventory");
  });

  it("planExtraction is byte-identical for identical input and stamps no clock of its own", () => {
    const plan = () => planExtraction(makeContext(), makeRequest());
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
    expect(JSON.stringify(plan())).not.toContain("plannedAt");
  });

  it("planExtraction mutates neither the context nor the request, and its result never aliases them", () => {
    const context = makeContext({ now: "2026-07-12T00:00:00.000Z" });
    const request = makeRequest({ factTypes: ["price", "currency"] });
    const contextSnapshot = structuredClone(context);
    const requestSnapshot = structuredClone(request);
    const result = planExtraction(context, request);
    expect(context).toEqual(contextSnapshot);
    expect(request).toEqual(requestSnapshot);

    // Mutating a plan must never reach back into the definition or the request.
    const plan = result.data[0];
    expect(plan.sourceVersion).not.toBe(request.source.version);
    expect(plan.targets).not.toBe(request.factTypes);
    expect(result.metadata.sourceVersion).not.toBe(request.source.version);
    plan.targets.push("bedrooms");
    plan.sourceVersion.major = 99;
    expect(context).toEqual(contextSnapshot);
    expect(request).toEqual(requestSnapshot);
  });

  it("describeExtractionFact does not mutate its input, and its result never aliases it", () => {
    const input = makeFactInput({ derivedFrom: undefined });
    const snapshot = structuredClone(input);
    const fact = describeExtractionFact(input);
    expect(input).toEqual(snapshot);

    expect(fact.sourceVersion).not.toBe(input.sourceVersion);
    expect(fact.provenance.method).not.toBe(input.method);
    expect(fact.confidence).not.toBe(input.confidence);
    expect(fact.evidence.locator).not.toBe(input.locator);
    expect(fact.structuredValue).not.toBe(input.structuredValue);
    fact.sourceVersion.major = 99;
    fact.provenance.method.kind = "ocr";
    expect(input).toEqual(snapshot);
    expect(describeExtractionFact(input).sourceVersion.major).toBe(1);
  });

  it("does not mutate the catalogue it validates or appends to, nor the facts it validates or sorts", () => {
    const catalog = makeCatalog({ entries: [makeEntry(), makeEntry({ enabled: false })] });
    const catalogSnapshot = structuredClone(catalog);
    validateExtractionCatalog(catalog);
    addExtractionCatalogEntry(catalog, makeEntry());
    expect(catalog).toEqual(catalogSnapshot);

    const facts = [makeFact(), makeFact({ status: "superseded" })];
    const factsSnapshot = structuredClone(facts);
    validateExtractionFacts(facts);
    sortExtractionFacts(facts);
    expect(facts).toEqual(factsSnapshot);
  });

  it("validation is deterministic: identical input yields identical issues", () => {
    const fact = makeFact({ status: "superseded" });
    expect(validateExtractionFacts([fact])).toEqual(validateExtractionFacts([fact]));
    expect(validateExtractionCatalog(makeCatalog())).toEqual(
      validateExtractionCatalog(makeCatalog()),
    );
  });
});
