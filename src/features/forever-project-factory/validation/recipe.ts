/**
 * Forever Project Factory — recipe validation.
 *
 * Composes the stage guard and adds the checks that span a whole
 * {@link FactoryRecipe}: it must carry an id and a name, name the RC4.2
 * template it generates from, declare at least one stage, stage ids must be
 * unique, its default entities must be known RC3.1 kinds declared at most
 * once, and a recipe that never verifies its output is flagged (a warning — a
 * generation that skips the reused validation pipeline). All checks return
 * issues; none throw.
 */

import { isNonEmptyString } from "../helpers";
import type { FactoryRecipe } from "../recipe";
import { factoryError, factoryWarning, isKnownFactoryEntityKind } from "../types";
import type { FactoryIssue } from "../types";
import { validateFactoryStage } from "./stage";

function at(base: string, path: string): string {
  return base === "" ? path : `${base}.${path}`;
}

/** Validate a whole recipe. `base` locates it, e.g. `recipes.0`; empty when standalone. */
export function validateFactoryRecipe(recipe: FactoryRecipe, base = ""): FactoryIssue[] {
  const issues: FactoryIssue[] = [];

  if (!isNonEmptyString(recipe.id)) {
    issues.push(
      factoryError("missing_recipe_id", "Factory recipe is missing an id", at(base, "id")),
    );
  }
  if (!isNonEmptyString(recipe.name)) {
    issues.push(
      factoryError("missing_recipe_name", "Factory recipe is missing a name", at(base, "name")),
    );
  }
  if (!isNonEmptyString(recipe.templateId)) {
    issues.push(
      factoryError(
        "missing_recipe_template",
        "Factory recipe does not name a template it generates from",
        at(base, "templateId"),
      ),
    );
  }

  const stages = Array.isArray(recipe.stages) ? recipe.stages : [];
  if (stages.length === 0) {
    issues.push(
      factoryError(
        "no_stages",
        "Factory recipe must declare at least one stage",
        at(base, "stages"),
      ),
    );
  }

  const stageIds = new Set<string>();
  stages.forEach((stage, index) => {
    issues.push(...validateFactoryStage(stage, at(base, `stages.${index}`)));
    if (isNonEmptyString(stage.id)) {
      if (stageIds.has(stage.id)) {
        issues.push(
          factoryError(
            "duplicate_stage_id",
            `Factory stage id "${stage.id}" is declared more than once`,
            at(base, `stages.${index}.id`),
          ),
        );
      }
      stageIds.add(stage.id);
    }
  });

  if (stages.length > 0 && !stages.some((stage) => stage.kind === "verify")) {
    issues.push(
      factoryWarning(
        "no_verify_stage",
        "Factory recipe declares no verify stage",
        at(base, "stages"),
      ),
    );
  }

  const seenEntities = new Set<string>();
  (Array.isArray(recipe.entities) ? recipe.entities : []).forEach((kind, index) => {
    if (!isKnownFactoryEntityKind(kind)) {
      issues.push(
        factoryError(
          "unknown_recipe_entity",
          `Factory recipe covers an unknown entity kind "${String(kind)}"`,
          at(base, `entities.${index}`),
        ),
      );
    }
    if (seenEntities.has(kind)) {
      issues.push(
        factoryError(
          "duplicate_recipe_entity",
          `Factory recipe covers entity kind "${String(kind)}" more than once`,
          at(base, `entities.${index}`),
        ),
      );
    }
    seenEntities.add(kind);
  });

  return issues;
}
