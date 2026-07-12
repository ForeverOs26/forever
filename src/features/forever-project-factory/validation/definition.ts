/**
 * Forever Project Factory — definition validation.
 *
 * Composes the identity, version, policy, and recipe guards and adds the checks
 * that span a whole {@link FactoryDefinition}: a factory must declare at least
 * one recipe, recipe ids must be unique, it must cover at least one canonical
 * entity kind without repeating one, and — as warnings — every entity a recipe
 * or step names should be one the factory declares it covers. The version and
 * policy guards are the reused RC4.0 ones; nothing is restated. All checks
 * return issues; none throw.
 */

import type { FactoryDefinition } from "../definition";
import { isNonEmptyString, listFactoryRecipeSteps } from "../helpers";
import { factoryError, factoryWarning, isKnownFactoryEntityKind } from "../types";
import type { FactoryIssue } from "../types";
import { validateFactoryIdentity } from "./identity";
import { validateFactoryPolicy } from "./policy";
import { validateFactoryRecipe } from "./recipe";
import { validateFactoryVersion } from "./version";

/** Validate a whole factory definition, composing every sub-guard. */
export function validateFactoryDefinition(definition: FactoryDefinition): FactoryIssue[] {
  const issues: FactoryIssue[] = [];
  issues.push(...validateFactoryIdentity(definition.identity));

  if (definition.version === undefined) {
    issues.push(factoryError("missing_factory_version", "Factory is missing a version", "version"));
  } else {
    issues.push(...validateFactoryVersion(definition.version));
  }

  if (definition.policy !== undefined) {
    issues.push(...validateFactoryPolicy(definition.policy));
  }

  const recipes = Array.isArray(definition.recipes) ? definition.recipes : [];
  if (recipes.length === 0) {
    issues.push(factoryError("no_recipes", "Factory must declare at least one recipe", "recipes"));
  }

  const recipeIds = new Set<string>();
  recipes.forEach((recipe, index) => {
    issues.push(...validateFactoryRecipe(recipe, `recipes.${index}`));
    if (isNonEmptyString(recipe.id)) {
      if (recipeIds.has(recipe.id)) {
        issues.push(
          factoryError(
            "duplicate_recipe_id",
            `Factory recipe id "${recipe.id}" is declared more than once`,
            `recipes.${index}.id`,
          ),
        );
      }
      recipeIds.add(recipe.id);
    }
  });

  const entities = Array.isArray(definition.entities) ? definition.entities : [];
  if (entities.length === 0) {
    issues.push(
      factoryError(
        "no_entities",
        "Factory must cover at least one canonical entity kind",
        "entities",
      ),
    );
  }
  const seenEntities = new Set<string>();
  entities.forEach((kind, index) => {
    if (!isKnownFactoryEntityKind(kind)) {
      issues.push(
        factoryError(
          "unknown_entity",
          `Factory covers an unknown entity kind "${String(kind)}"`,
          `entities.${index}`,
        ),
      );
    }
    if (seenEntities.has(kind)) {
      issues.push(
        factoryError(
          "duplicate_entity",
          `Factory covers entity kind "${String(kind)}" more than once`,
          `entities.${index}`,
        ),
      );
    }
    seenEntities.add(kind);
  });

  // A recipe or step should only name an entity the factory declares it covers.
  recipes.forEach((recipe, index) => {
    (Array.isArray(recipe.entities) ? recipe.entities : []).forEach((kind) => {
      if (!entities.includes(kind)) {
        issues.push(
          factoryWarning(
            "undeclared_recipe_entity",
            `Recipe "${String(recipe.id)}" covers entity "${String(kind)}" not declared by the factory`,
            `recipes.${index}.entities`,
          ),
        );
      }
    });
    const steps = Array.isArray(recipe.stages) ? listFactoryRecipeSteps(recipe) : [];
    steps.forEach((step) => {
      const entityKind = step?.entityKind;
      if (entityKind !== undefined && !entities.includes(entityKind)) {
        issues.push(
          factoryWarning(
            "undeclared_step_entity",
            `Step "${String(step.id)}" concerns entity "${String(entityKind)}" not declared by the factory`,
            `recipes.${index}.stages`,
          ),
        );
      }
    });
  });

  return issues;
}
