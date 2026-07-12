/**
 * Forever Extraction Pipeline — definition validation.
 *
 * Composes the identity, version, policy, and recipe guards and adds the
 * checks that span a whole {@link ExtractionDefinition}: a definition must
 * declare at least one recipe, recipe ids must be unique, it must cover at
 * least one known fact type without repeating one, and — as warnings — every
 * fact type a recipe or step names should be one the definition declares it
 * covers. The version and policy guards are the reused RC4.4/RC4.0 ones;
 * nothing is restated. A structurally absent part (`null` or `undefined`) is
 * reported as missing, never dereferenced. All checks return issues; none
 * throw.
 */

import type { ExtractionDefinition } from "../definition";
import { isKnownExtractionFactType } from "../facttype";
import { isAbsent, isNonEmptyString } from "../helpers";
import { extractionError, extractionWarning } from "../types";
import type { ExtractionIssue } from "../types";
import { validateExtractionIdentity } from "./identity";
import { validateExtractionPolicy } from "./policy";
import { validateExtractionRecipe } from "./recipe";
import { validateExtractionVersion } from "./version";

/** Validate a whole extraction definition, composing every sub-guard. */
export function validateExtractionDefinition(definition: ExtractionDefinition): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];

  if (isAbsent(definition.identity)) {
    issues.push(
      extractionError(
        "missing_extraction_identity",
        "Extraction definition is missing an identity",
        "identity",
      ),
    );
  } else {
    issues.push(...validateExtractionIdentity(definition.identity));
  }

  if (isAbsent(definition.version)) {
    issues.push(
      extractionError(
        "missing_extraction_version",
        "Extraction definition is missing a version",
        "version",
      ),
    );
  } else {
    issues.push(...validateExtractionVersion(definition.version));
  }

  if (!isAbsent(definition.policy)) {
    issues.push(...validateExtractionPolicy(definition.policy));
  }

  const recipes = Array.isArray(definition.recipes) ? definition.recipes : [];
  if (recipes.length === 0) {
    issues.push(
      extractionError(
        "no_recipes",
        "Extraction definition must declare at least one recipe",
        "recipes",
      ),
    );
  }

  const recipeIds = new Set<string>();
  recipes.forEach((recipe, index) => {
    if (isAbsent(recipe)) {
      issues.push(
        extractionError(
          "missing_recipe",
          "Extraction definition declares an absent recipe",
          `recipes.${index}`,
        ),
      );
      return;
    }
    issues.push(...validateExtractionRecipe(recipe, `recipes.${index}`));
    if (isNonEmptyString(recipe.id)) {
      if (recipeIds.has(recipe.id)) {
        issues.push(
          extractionError(
            "duplicate_recipe_id",
            `Extraction recipe id "${recipe.id}" is declared more than once`,
            `recipes.${index}.id`,
          ),
        );
      }
      recipeIds.add(recipe.id);
    }
  });

  const factTypes = Array.isArray(definition.factTypes) ? definition.factTypes : [];
  if (factTypes.length === 0) {
    issues.push(
      extractionError(
        "no_fact_types",
        "Extraction definition must cover at least one fact type",
        "factTypes",
      ),
    );
  }
  const seenFactTypes = new Set<string>();
  factTypes.forEach((factType, index) => {
    if (!isKnownExtractionFactType(factType)) {
      issues.push(
        extractionError(
          "unsupported_fact_type",
          `Extraction definition covers an unsupported fact type "${String(factType)}"`,
          `factTypes.${index}`,
        ),
      );
    }
    if (seenFactTypes.has(factType)) {
      issues.push(
        extractionError(
          "duplicate_fact_type",
          `Extraction definition covers fact type "${String(factType)}" more than once`,
          `factTypes.${index}`,
        ),
      );
    }
    seenFactTypes.add(factType);
  });

  // A recipe or step should only name a fact type the definition declares it
  // covers.
  recipes.forEach((recipe, index) => {
    if (isAbsent(recipe)) return;
    (Array.isArray(recipe.factTypes) ? recipe.factTypes : []).forEach((factType) => {
      if (!factTypes.includes(factType)) {
        issues.push(
          extractionWarning(
            "undeclared_recipe_fact_type",
            `Recipe "${String(recipe.id)}" produces fact type "${String(
              factType,
            )}" not declared by the definition`,
            `recipes.${index}.factTypes`,
          ),
        );
      }
    });
    const steps = Array.isArray(recipe.stages)
      ? recipe.stages.flatMap((stage) => (Array.isArray(stage?.steps) ? stage.steps : []))
      : [];
    steps.forEach((step) => {
      (Array.isArray(step?.factTypes) ? step.factTypes : []).forEach((factType) => {
        if (!factTypes.includes(factType)) {
          issues.push(
            extractionWarning(
              "undeclared_step_fact_type",
              `Step "${String(step.id)}" concerns fact type "${String(
                factType,
              )}" not declared by the definition`,
              `recipes.${index}.stages`,
            ),
          );
        }
      });
    });
  });

  return issues;
}
