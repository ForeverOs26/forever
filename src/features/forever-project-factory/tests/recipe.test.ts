import { describe, expect, it } from "vitest";

import {
  FOREVER_PROJECT_TEMPLATE_ID,
  buildForeverProjectTemplate,
  requiredProjectComponentKinds,
} from "@/features/forever-project-template";

import {
  FOREVER_PROJECT_RECIPE_ID,
  factoryRecipe,
  factoryRecipeComponentKinds,
  foreverProjectFactoryRecipe,
  isKnownFactoryStepKind,
  listFactoryRecipeSteps,
} from "..";

describe("the canonical recipe", () => {
  it("generates from the canonical RC4.2 template", () => {
    const recipe = foreverProjectFactoryRecipe();
    expect(recipe.id).toBe(FOREVER_PROJECT_RECIPE_ID);
    expect(recipe.templateId).toBe(FOREVER_PROJECT_TEMPLATE_ID);
  });

  it("declares the four generation stages in order", () => {
    expect(foreverProjectFactoryRecipe().stages.map((stage) => stage.kind)).toEqual([
      "prepare",
      "generate",
      "assemble",
      "verify",
    ]);
  });

  it("declares steps with unique ids and known kinds", () => {
    const steps = listFactoryRecipeSteps(foreverProjectFactoryRecipe());
    expect(steps.length).toBeGreaterThan(0);
    expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
    for (const step of steps) {
      expect(isKnownFactoryStepKind(step.kind)).toBe(true);
    }
  });

  it("materializes every component the canonical template requires", () => {
    const materialized = factoryRecipeComponentKinds(foreverProjectFactoryRecipe());
    for (const kind of requiredProjectComponentKinds(buildForeverProjectTemplate())) {
      expect(materialized).toContain(kind);
    }
  });
});

describe("the recipe builder", () => {
  it("attaches entities and description only when supplied", () => {
    const bare = factoryRecipe("custom", "Custom", FOREVER_PROJECT_TEMPLATE_ID, []);
    expect("entities" in bare).toBe(false);
    expect("description" in bare).toBe(false);

    const full = factoryRecipe("custom", "Custom", FOREVER_PROJECT_TEMPLATE_ID, [], {
      entities: ["project"],
      description: "A custom recipe.",
    });
    expect(full.entities).toEqual(["project"]);
    expect(full.description).toBe("A custom recipe.");
  });
});
