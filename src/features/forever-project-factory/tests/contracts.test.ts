import { describe, expect, it } from "vitest";

import { FOREVER_PROJECT_TEMPLATE_ID } from "@/features/forever-project-template";

import {
  defineFactoryProvider,
  factoryProviderCovers,
  factoryProviderGeneratesFrom,
  factoryProviderRecipeCount,
  factoryProviderStepCount,
} from "..";
import { makeFactory } from "./fixtures";

describe("the factory provider contract", () => {
  it("pins an implementation without changing it", () => {
    const provider = { definition: makeFactory() };
    expect(defineFactoryProvider(provider)).toBe(provider);
  });

  it("answers coverage and template questions from the definition alone", () => {
    const provider = defineFactoryProvider({ definition: makeFactory() });
    expect(factoryProviderCovers(provider, "project")).toBe(true);
    expect(factoryProviderCovers(provider, "developer")).toBe(false);
    expect(factoryProviderGeneratesFrom(provider, FOREVER_PROJECT_TEMPLATE_ID)).toBe(true);
    expect(factoryProviderGeneratesFrom(provider, "tmpl_unknown")).toBe(false);
  });

  it("counts recipes and steps through the shared helpers", () => {
    const provider = defineFactoryProvider({ definition: makeFactory() });
    expect(factoryProviderRecipeCount(provider)).toBe(1);
    expect(factoryProviderStepCount(provider)).toBe(8);
  });
});
