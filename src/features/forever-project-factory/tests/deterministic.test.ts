import { describe, expect, it } from "vitest";

import {
  addFactoryCatalogEntry,
  buildForeverProjectFactory,
  foreverProjectFactoryRecipe,
  planFactoryBuild,
  validateFactoryCatalog,
} from "..";
import { makeCatalog, makeContext, makeEntry, makeRequest } from "./fixtures";

describe("deterministic foundation", () => {
  it("canonical factory and recipe are pure: equal, independent values per call", () => {
    expect(buildForeverProjectFactory()).toEqual(buildForeverProjectFactory());
    expect(foreverProjectFactoryRecipe()).toEqual(foreverProjectFactoryRecipe());

    const mutated = buildForeverProjectFactory();
    mutated.recipes.pop();
    expect(buildForeverProjectFactory().recipes).toHaveLength(1);
  });

  it("planFactoryBuild is byte-identical for identical input and stamps no clock of its own", () => {
    const plan = () => planFactoryBuild(makeContext(), makeRequest());
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
    expect(JSON.stringify(plan())).not.toContain("plannedAt");
  });

  it("planFactoryBuild mutates neither the context nor the request, and its result never aliases them", () => {
    const context = makeContext({ now: "2026-07-12T00:00:00.000Z" });
    const request = makeRequest({ provides: ["identity"] });
    const contextSnapshot = structuredClone(context);
    const requestSnapshot = structuredClone(request);
    const result = planFactoryBuild(context, request);
    expect(context).toEqual(contextSnapshot);
    expect(request).toEqual(requestSnapshot);

    // Mutating a plan must never reach back into the definition or the request.
    expect(result.data[0].package.provides).not.toBe(request.provides);
    expect(result.data[0].package.entities).not.toBe(context.definition.recipes[0].entities);
    result.data[0].package.entities.push("document");
    result.data[0].package.provides.push("connector");
    expect(context).toEqual(contextSnapshot);
    expect(request).toEqual(requestSnapshot);
  });

  it("does not mutate the catalogue it validates or appends to", () => {
    const catalog = makeCatalog({ entries: [makeEntry(), makeEntry({ enabled: true })] });
    const snapshot = structuredClone(catalog);
    validateFactoryCatalog(catalog);
    addFactoryCatalogEntry(catalog, makeEntry({ enabled: true }));
    expect(catalog).toEqual(snapshot);
  });
});
