/**
 * Forever Extraction Pipeline — recipe validation.
 *
 * Composes the stage and method guards and adds the checks that span a whole
 * {@link ExtractionRecipe}: it must carry an id and a name, declare at least
 * one stage with unique stage ids, produce at least one known fact type
 * declared at most once, and — when it narrows what it reads — every declared
 * document type and file format must be a known RC4.4 vocabulary value
 * (reusing the RC4.4 runtime guards, never a local list) declared at most
 * once. A recipe that never verifies its output is flagged (a warning — an
 * extraction that skips the validation pipeline). All checks return issues;
 * none throw.
 */

import {
  isKnownProjectSourceDocumentType,
  isKnownProjectSourceFileFormat,
} from "@/features/forever-project-sources";

import { isKnownExtractionFactType } from "../facttype";
import { isAbsent, isNonEmptyString } from "../helpers";
import type { ExtractionRecipe } from "../recipe";
import { extractionError, extractionWarning } from "../types";
import type { ExtractionIssue } from "../types";
import { validateExtractionMethod } from "./method";
import { validateExtractionStage } from "./stage";

function at(base: string, path: string): string {
  return base === "" ? path : `${base}.${path}`;
}

/** Validate a whole recipe. `base` locates it, e.g. `recipes.0`; empty when standalone. */
export function validateExtractionRecipe(recipe: ExtractionRecipe, base = ""): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];

  if (!isNonEmptyString(recipe.id)) {
    issues.push(
      extractionError("missing_recipe_id", "Extraction recipe is missing an id", at(base, "id")),
    );
  }
  if (!isNonEmptyString(recipe.name)) {
    issues.push(
      extractionError(
        "missing_recipe_name",
        "Extraction recipe is missing a name",
        at(base, "name"),
      ),
    );
  }

  const stages = Array.isArray(recipe.stages) ? recipe.stages : [];
  if (stages.length === 0) {
    issues.push(
      extractionError(
        "no_stages",
        "Extraction recipe must declare at least one stage",
        at(base, "stages"),
      ),
    );
  }

  const stageIds = new Set<string>();
  stages.forEach((stage, index) => {
    if (isAbsent(stage)) {
      issues.push(
        extractionError(
          "missing_stage",
          "Extraction recipe declares an absent stage",
          at(base, `stages.${index}`),
        ),
      );
      return;
    }
    issues.push(...validateExtractionStage(stage, at(base, `stages.${index}`)));
    if (isNonEmptyString(stage.id)) {
      if (stageIds.has(stage.id)) {
        issues.push(
          extractionError(
            "duplicate_stage_id",
            `Extraction stage id "${stage.id}" is declared more than once`,
            at(base, `stages.${index}.id`),
          ),
        );
      }
      stageIds.add(stage.id);
    }
  });

  if (stages.length > 0 && !stages.some((stage) => stage?.kind === "verify")) {
    issues.push(
      extractionWarning(
        "no_verify_stage",
        "Extraction recipe declares no verify stage",
        at(base, "stages"),
      ),
    );
  }

  const factTypes = Array.isArray(recipe.factTypes) ? recipe.factTypes : [];
  if (factTypes.length === 0) {
    issues.push(
      extractionError(
        "no_recipe_fact_types",
        "Extraction recipe must declare at least one fact type it can produce",
        at(base, "factTypes"),
      ),
    );
  }
  const seenFactTypes = new Set<string>();
  factTypes.forEach((factType, index) => {
    if (!isKnownExtractionFactType(factType)) {
      issues.push(
        extractionError(
          "unsupported_fact_type",
          `Extraction recipe declares an unsupported fact type "${String(factType)}"`,
          at(base, `factTypes.${index}`),
        ),
      );
    }
    if (seenFactTypes.has(factType)) {
      issues.push(
        extractionError(
          "duplicate_recipe_fact_type",
          `Extraction recipe declares fact type "${String(factType)}" more than once`,
          at(base, `factTypes.${index}`),
        ),
      );
    }
    seenFactTypes.add(factType);
  });

  if (recipe.documentTypes !== undefined && !Array.isArray(recipe.documentTypes)) {
    issues.push(
      extractionError(
        "invalid_document_types",
        "Extraction recipe declares a non-list documentTypes value",
        at(base, "documentTypes"),
      ),
    );
  } else if (recipe.documentTypes !== undefined) {
    const seen = new Set<string>();
    recipe.documentTypes.forEach((documentType, index) => {
      if (!isKnownProjectSourceDocumentType(documentType)) {
        issues.push(
          extractionError(
            "unknown_document_type",
            `Extraction recipe reads an unknown document type "${String(documentType)}"`,
            at(base, `documentTypes.${index}`),
          ),
        );
      }
      if (seen.has(documentType)) {
        issues.push(
          extractionError(
            "duplicate_document_type",
            `Extraction recipe reads document type "${String(documentType)}" more than once`,
            at(base, `documentTypes.${index}`),
          ),
        );
      }
      seen.add(documentType);
    });
  }

  if (recipe.fileFormats !== undefined && !Array.isArray(recipe.fileFormats)) {
    issues.push(
      extractionError(
        "invalid_file_formats",
        "Extraction recipe declares a non-list fileFormats value",
        at(base, "fileFormats"),
      ),
    );
  } else if (recipe.fileFormats !== undefined) {
    const seen = new Set<string>();
    recipe.fileFormats.forEach((fileFormat, index) => {
      if (!isKnownProjectSourceFileFormat(fileFormat)) {
        issues.push(
          extractionError(
            "unknown_file_format",
            `Extraction recipe reads an unknown file format "${String(fileFormat)}"`,
            at(base, `fileFormats.${index}`),
          ),
        );
      }
      if (seen.has(fileFormat)) {
        issues.push(
          extractionError(
            "duplicate_file_format",
            `Extraction recipe reads file format "${String(fileFormat)}" more than once`,
            at(base, `fileFormats.${index}`),
          ),
        );
      }
      seen.add(fileFormat);
    });
  }

  if (!isAbsent(recipe.method)) {
    issues.push(...validateExtractionMethod(recipe.method, at(base, "method")));
  }

  return issues;
}
