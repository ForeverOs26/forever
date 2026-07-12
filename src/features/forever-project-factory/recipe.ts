/**
 * Forever Project Factory — the recipe descriptor and the canonical recipe.
 *
 * A {@link FactoryRecipe} is the complete, declarative description of how one
 * kind of package is generated: the RC4.2 template it generates from and the
 * ordered {@link FactoryStage}s (and their steps) the generation is composed
 * of. It is the unit a {@link import("./definition").FactoryDefinition} carries
 * — the factory's answer to "how is a project built?", expressed as data.
 *
 * {@link foreverProjectFactoryRecipe} returns *the* canonical recipe: how any
 * Forever project package is generated from the canonical RC4.2 template. It is
 * a pure factory — it reads no clock and holds no shared state, so every call
 * returns an equal, independent value that is safe to mutate, diff, and
 * validate. The recipe describes generation only; it never generates a
 * package's data — {@link import("./build").planFactoryBuild} describes what
 * following the recipe would produce, and even that never writes.
 */

import type { ProjectTemplateId } from "@/features/forever-project-template";
import { FOREVER_PROJECT_TEMPLATE_ID } from "@/features/forever-project-template";

import { factoryStage, type FactoryStage } from "./stage";
import { factoryStep } from "./step";
import type { FactoryEntityKind } from "./types";

/** The full declarative description of how one kind of package is generated. */
export interface FactoryRecipe {
  /** Stable id, unique within its factory, e.g. `forever-project`. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** The RC4.2 template the recipe generates a package from. */
  templateId: ProjectTemplateId;
  /** The ordered stages the generation is composed of. */
  stages: FactoryStage[];
  /** Canonical entity kinds a generated package covers by default. Reuses the RC3.1 kinds. */
  entities?: FactoryEntityKind[];
  /** Free-text description of what the recipe generates. */
  description?: string;
}

/** Options accepted by {@link factoryRecipe}. */
export interface FactoryRecipeOptions {
  entities?: FactoryEntityKind[];
  description?: string;
}

/**
 * Build a {@link FactoryRecipe}; optional facts are attached only when supplied
 * so an absent fact stays absent (anti-fabrication).
 */
export function factoryRecipe(
  id: string,
  name: string,
  templateId: ProjectTemplateId,
  stages: FactoryStage[],
  options: FactoryRecipeOptions = {},
): FactoryRecipe {
  const recipe: FactoryRecipe = { id, name, templateId, stages };
  if (options.entities !== undefined) recipe.entities = options.entities;
  if (options.description !== undefined) recipe.description = options.description;
  return recipe;
}

/** The canonical recipe's stable id. */
export const FOREVER_PROJECT_RECIPE_ID = "forever-project";

/**
 * Build *the* canonical Forever project recipe: how any Forever project package
 * is generated from the canonical RC4.2 template.
 *
 * Pure and deterministic: every call returns an equal, independent value with
 * no shared state. Its steps materialize — never re-implement — the RC4.2
 * component vocabulary, so the recipe covers every component the canonical
 * template requires. The `register-package` step is optional by contract: a
 * build may legitimately be planned without being catalogued, so the fact stays
 * absent rather than being fabricated.
 */
export function foreverProjectFactoryRecipe(): FactoryRecipe {
  return factoryRecipe(
    FOREVER_PROJECT_RECIPE_ID,
    "Forever Project Recipe",
    FOREVER_PROJECT_TEMPLATE_ID,
    [
      factoryStage("prepare", "Prepare", "prepare", [
        factoryStep("normalize-slug", "Normalize the verified slug", "identity", {
          components: ["identity"],
          description: "Normalize the caller-supplied slug through the RC3.0 slug rule.",
        }),
        factoryStep("derive-identity", "Derive the package identity", "identity", {
          components: ["identity"],
          entityKind: "project",
          description:
            "Derive the package, canonical project, and integration ids from the verified slug.",
        }),
        factoryStep("select-template", "Select the canonical template", "template", {
          description: "Resolve the RC4.2 template the package is generated from.",
        }),
      ]),
      factoryStage("generate", "Generate", "generate", [
        factoryStep("describe-package", "Describe the project package", "package", {
          components: ["sources", "connector", "pipeline", "canonical", "integration"],
          entityKind: "project",
          description: "Describe the RC4.2 package the project's verified source data provides.",
        }),
        factoryStep("render-layout", "Render the package layout", "layout", {
          description: "Render the template's layout root for the project slug.",
        }),
      ]),
      factoryStage("assemble", "Assemble", "assemble", [
        factoryStep("assemble-bundle", "Assemble the project bundle", "bundle", {
          components: ["references"],
          description: "Measure the described package against the template it conforms to.",
        }),
        factoryStep("register-package", "Describe the catalogue entry", "register", {
          optional: true,
          description: "Describe the catalogue entry a registrar would add for the package.",
        }),
      ]),
      factoryStage("verify", "Verify", "verify", [
        factoryStep("validate-bundle", "Validate the assembled bundle", "validate", {
          components: ["verification"],
          description: "Run the reused RC4.2 validation pipeline over the assembled bundle.",
        }),
      ]),
    ],
    {
      entities: ["project"],
      description:
        "How any Forever project package is generated from the canonical RC4.2 template: provide a verified slug and verified source data, the factory describes everything else.",
    },
  );
}
