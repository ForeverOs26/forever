/**
 * Forever Project Factory — deterministic, immutable helpers.
 *
 * Pure, side-effect-free utilities shared across the foundation: stable natural
 * keys for factories, recipe lookups, structural counters, and distinct
 * collectors over the reused vocabularies (RC4.2 templates and component kinds,
 * RC3.1 entity kinds). Given the same input they always return the same output
 * — no randomness, no clocks, no locale — so the whole module stays
 * deterministic and these helpers never need re-implementing per call site.
 *
 * The string guard and the stats combiners are reused verbatim from the Forever
 * Project Integration (RC4.0) helpers rather than restated, so RC4.3 shares one
 * definition of "non-empty string" and one way of merging counters with the
 * validation and result machinery it also reuses.
 */

import type { ProjectComponentKind, ProjectTemplateId } from "@/features/forever-project-template";
import { isNonEmptyString } from "@/features/forever-project-template";

import type { FactoryDefinition } from "./definition";
import type { FactoryIdentity } from "./identity";
import type { FactoryRecipe } from "./recipe";
import type { FactoryStep } from "./step";
import type { FactoryEntityKind } from "./types";

export { isNonEmptyString };

// Reuse the RC4.0 stats combiners under factory-facing names — the stats shape
// is the RC4.0 one, so the arithmetic is too.
export {
  mergeProjectIntegrationStats as mergeFactoryStats,
  sumProjectIntegrationStats as sumFactoryStats,
} from "@/features/forever-project-integration";

/**
 * Stable key for a factory identity, independent of its surrogate id:
 * `scope:slug`. Two factory identities of the same scope under the same slug
 * share a key.
 */
export function factoryIdentityKey(identity: FactoryIdentity): string {
  return `${identity.scope}:${identity.slug}`;
}

/** Stable natural key for a factory definition, derived from its identity. */
export function factoryDefinitionKey(definition: FactoryDefinition): string {
  return factoryIdentityKey(definition.identity);
}

/** The number of recipes a factory declares. */
export function factoryRecipeCount(definition: FactoryDefinition): number {
  return definition.recipes.length;
}

/** The recipe of a factory with a given id, or `undefined`. */
export function findFactoryRecipe(
  definition: FactoryDefinition,
  recipeId: string,
): FactoryRecipe | undefined {
  return definition.recipes.find((recipe) => recipe.id === recipeId);
}

/** A factory's default recipe: the first it declares, or `undefined`. */
export function defaultFactoryRecipe(definition: FactoryDefinition): FactoryRecipe | undefined {
  return definition.recipes.length > 0 ? definition.recipes[0] : undefined;
}

/** The number of stages in a recipe. */
export function factoryRecipeStageCount(recipe: FactoryRecipe): number {
  return recipe.stages.length;
}

/** The total number of steps across every stage of a recipe. */
export function factoryRecipeStepCount(recipe: FactoryRecipe): number {
  return recipe.stages.reduce((total, stage) => total + stage.steps.length, 0);
}

/** Every step of a recipe, flattened in stage-then-step declared order. */
export function listFactoryRecipeSteps(recipe: FactoryRecipe): FactoryStep[] {
  return recipe.stages.flatMap((stage) => stage.steps);
}

/** The total number of stages across every recipe of a factory. */
export function factoryStageCount(definition: FactoryDefinition): number {
  return definition.recipes.reduce((total, recipe) => total + factoryRecipeStageCount(recipe), 0);
}

/** The total number of steps across every recipe of a factory. */
export function factoryStepCount(definition: FactoryDefinition): number {
  return definition.recipes.reduce((total, recipe) => total + factoryRecipeStepCount(recipe), 0);
}

/** The distinct RC4.2 templates a factory generates from, in first-seen order. */
export function factoryTemplateIds(definition: FactoryDefinition): ProjectTemplateId[] {
  const seen = new Set<ProjectTemplateId>();
  const ids: ProjectTemplateId[] = [];
  for (const recipe of definition.recipes) {
    if (!seen.has(recipe.templateId)) {
      seen.add(recipe.templateId);
      ids.push(recipe.templateId);
    }
  }
  return ids;
}

/**
 * The distinct RC4.2 component kinds a recipe's steps materialize, in
 * first-seen (stage-then-step declared) order.
 */
export function factoryRecipeComponentKinds(recipe: FactoryRecipe): ProjectComponentKind[] {
  const seen = new Set<ProjectComponentKind>();
  const kinds: ProjectComponentKind[] = [];
  for (const step of listFactoryRecipeSteps(recipe)) {
    for (const kind of step.components ?? []) {
      if (!seen.has(kind)) {
        seen.add(kind);
        kinds.push(kind);
      }
    }
  }
  return kinds;
}

/** The distinct entity kinds a recipe's steps concern, in first-seen order. */
export function factoryRecipeEntityKinds(recipe: FactoryRecipe): FactoryEntityKind[] {
  const seen = new Set<FactoryEntityKind>();
  const kinds: FactoryEntityKind[] = [];
  for (const step of listFactoryRecipeSteps(recipe)) {
    if (step.entityKind !== undefined && !seen.has(step.entityKind)) {
      seen.add(step.entityKind);
      kinds.push(step.entityKind);
    }
  }
  return kinds;
}
