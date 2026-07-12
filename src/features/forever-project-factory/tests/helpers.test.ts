import { describe, expect, it } from "vitest";

import {
  isNonEmptyString as integrationIsNonEmptyString,
  mergeProjectIntegrationStats,
  sumProjectIntegrationStats,
} from "@/features/forever-project-integration";
import { FOREVER_PROJECT_TEMPLATE_ID } from "@/features/forever-project-template";

import {
  FOREVER_PROJECT_RECIPE_ID,
  defaultFactoryRecipe,
  emptyFactoryStats,
  factoryDefinitionKey,
  factoryIdentityKey,
  factoryRecipeComponentKinds,
  factoryRecipeCount,
  factoryRecipeEntityKinds,
  factoryRecipeStageCount,
  factoryRecipeStepCount,
  factoryStepCount,
  factoryTemplateIds,
  findFactoryRecipe,
  foreverProjectFactoryRecipe,
  isNonEmptyString,
  listFactoryRecipeSteps,
  mergeFactoryStats,
  sumFactoryStats,
} from "..";
import { makeFactory } from "./fixtures";

describe("deterministic helpers", () => {
  it("reuses the RC4.0 string guard and stats combiners verbatim", () => {
    expect(isNonEmptyString).toBe(integrationIsNonEmptyString);
    expect(mergeFactoryStats).toBe(mergeProjectIntegrationStats);
    expect(sumFactoryStats).toBe(sumProjectIntegrationStats);
  });

  it("derives stable natural keys from scope and slug", () => {
    const factory = makeFactory();
    expect(factoryIdentityKey(factory.identity)).toBe("project:forever-project");
    expect(factoryDefinitionKey(factory)).toBe("project:forever-project");
  });

  it("counts recipes, stages, and steps structurally", () => {
    const factory = makeFactory();
    const recipe = foreverProjectFactoryRecipe();
    expect(factoryRecipeCount(factory)).toBe(1);
    expect(factoryRecipeStageCount(recipe)).toBe(4);
    expect(factoryRecipeStepCount(recipe)).toBe(8);
    expect(factoryStepCount(factory)).toBe(8);
    expect(listFactoryRecipeSteps(recipe)).toHaveLength(8);
  });

  it("finds a recipe by id and falls back to the first as default", () => {
    const factory = makeFactory();
    expect(findFactoryRecipe(factory, FOREVER_PROJECT_RECIPE_ID)?.id).toBe(
      FOREVER_PROJECT_RECIPE_ID,
    );
    expect(findFactoryRecipe(factory, "nope")).toBeUndefined();
    expect(defaultFactoryRecipe(factory)?.id).toBe(FOREVER_PROJECT_RECIPE_ID);
    expect(defaultFactoryRecipe(makeFactory({ recipes: [] }))).toBeUndefined();
  });

  it("collects distinct templates, components, and entities in first-seen order", () => {
    const factory = makeFactory();
    const recipe = foreverProjectFactoryRecipe();
    expect(factoryTemplateIds(factory)).toEqual([FOREVER_PROJECT_TEMPLATE_ID]);
    expect(factoryRecipeComponentKinds(recipe)).toEqual([
      "identity",
      "sources",
      "connector",
      "pipeline",
      "canonical",
      "integration",
      "references",
      "verification",
    ]);
    expect(factoryRecipeEntityKinds(recipe)).toEqual(["project"]);
  });

  it("sums stats field by field from a zeroed start", () => {
    const a = { ...emptyFactoryStats(), steps: 3, completed: 2, failed: 1 };
    const b = { ...emptyFactoryStats(), stages: 1, steps: 5, completed: 5 };
    expect(sumFactoryStats([a, b])).toEqual({
      stages: 1,
      steps: 8,
      completed: 7,
      skipped: 0,
      failed: 1,
      warnings: 0,
      errors: 0,
    });
  });
});
