import { describe, expect, it } from "vitest";

import {
  defineExtractionProvider,
  extractionProviderProduces,
  extractionProviderReads,
  extractionProviderRecipeCount,
  extractionProviderStepCount,
} from "..";
import { makeDefinition } from "./fixtures";

describe("extraction provider contract", () => {
  const provider = defineExtractionProvider({ definition: makeDefinition() });

  it("pins the contract without changing the provider", () => {
    const raw = { definition: makeDefinition() };
    expect(defineExtractionProvider(raw)).toBe(raw);
    expect(provider.definition.identity.slug).toBe("forever-extraction");
  });

  it("answers coverage, reading, and structure from the definition alone", () => {
    expect(extractionProviderProduces(provider, "price")).toBe(true);
    expect(extractionProviderProduces(provider, "unknown")).toBe(false);
    expect(extractionProviderRecipeCount(provider)).toBe(1);
    expect(extractionProviderStepCount(provider)).toBe(9);

    // The canonical recipe restricts no document type, so it reads none *by name*.
    expect(extractionProviderReads(provider, "price_list")).toBe(false);
    const narrowed = defineExtractionProvider({ definition: makeDefinition() });
    narrowed.definition.recipes[0].documentTypes = ["price_list"];
    expect(extractionProviderReads(narrowed, "price_list")).toBe(true);
  });
});
