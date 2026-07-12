import { describe, expect, it } from "vitest";

import { ExtractionRegistry, deriveExtractionIdentity } from "..";
import { makeDefinition } from "./fixtures";

describe("ExtractionRegistry", () => {
  it("registers, resolves, and lists in insertion order", () => {
    const registry = new ExtractionRegistry();
    const definition = makeDefinition();
    registry.register(definition);

    expect(registry.has(definition.identity.id)).toBe(true);
    expect(registry.resolve(definition.identity.id)).toBe(definition);
    expect(registry.resolve("extr_unknown")).toBeUndefined();
    expect(registry.list()).toEqual([definition]);
  });

  it("throws on a duplicate id so a clash is caught at wiring time", () => {
    const registry = new ExtractionRegistry().register(makeDefinition());
    expect(() => registry.register(makeDefinition())).toThrow(/already registered/);
  });

  it("filters by fact type and by the RC4.4 document types its recipes read", () => {
    const general = makeDefinition();
    const priceListsOnly = makeDefinition({
      identity: deriveExtractionIdentity("price-list-extraction"),
      factTypes: ["price", "currency"],
    });
    priceListsOnly.recipes = [{ ...priceListsOnly.recipes[0], documentTypes: ["price_list"] }];
    const registry = new ExtractionRegistry().register(general).register(priceListsOnly);

    expect(registry.listByFactType("price")).toEqual([general, priceListsOnly]);
    expect(registry.listByFactType("bedrooms")).toEqual([general]);
    expect(registry.listByDocumentType("price_list")).toEqual([priceListsOnly]);
    expect(registry.listByDocumentType("brochure")).toEqual([]);
  });
});
