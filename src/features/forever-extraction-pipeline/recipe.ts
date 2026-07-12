/**
 * Forever Extraction Pipeline — the recipe descriptor and the canonical recipe.
 *
 * An {@link ExtractionRecipe} is the complete, declarative description of how
 * facts are produced from one kind of registered source: which RC4.4 document
 * types and file formats it reads (reused vocabularies, never parallel ones),
 * the method a runtime would apply, the fact types it can yield, and the
 * ordered {@link ExtractionStage}s (and their steps) the extraction is
 * composed of. It is the unit an
 * {@link import("./definition").ExtractionDefinition} carries — the
 * pipeline's answer to "how does a source produce facts?", expressed as data.
 *
 * {@link foreverExtractionRecipe} returns *the* canonical recipe: how any
 * catalogued Forever source is read into structured facts. It is a pure
 * factory — it reads no clock and holds no shared state, so every call
 * returns an equal, independent value that is safe to mutate, diff, and
 * validate. The recipe describes extraction only; it never extracts a fact —
 * {@link import("./plan").planExtraction} describes what following the recipe
 * would target, and even that produces no values.
 */

import type {
  ProjectSourceDocumentType,
  ProjectSourceFileFormat,
} from "@/features/forever-project-sources";

import type { ExtractionFactType } from "./facttype";
import { SUPPORTED_EXTRACTION_FACT_TYPES } from "./facttype";
import type { ExtractionMethodDescriptor } from "./method";
import { extractionStage, type ExtractionStage } from "./stage";
import { extractionStep } from "./step";

/** The full declarative description of how one kind of source produces facts. */
export interface ExtractionRecipe {
  /** Stable id, unique within its definition, e.g. `forever-extraction`. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** The ordered stages the extraction is composed of. */
  stages: ExtractionStage[];
  /** The fact types the recipe can produce, in declared order. */
  factTypes: ExtractionFactType[];
  /** RC4.4 document types the recipe reads; absent means any. Reused vocabulary. */
  documentTypes?: ProjectSourceDocumentType[];
  /** RC4.4 file formats the recipe reads; absent means any. Reused vocabulary. */
  fileFormats?: ProjectSourceFileFormat[];
  /** The method a runtime would apply, when the recipe designates one. */
  method?: ExtractionMethodDescriptor;
  /** Free-text description of what the recipe extracts. */
  description?: string;
}

/** Options accepted by {@link extractionRecipe}. */
export interface ExtractionRecipeOptions {
  documentTypes?: ProjectSourceDocumentType[];
  fileFormats?: ProjectSourceFileFormat[];
  method?: ExtractionMethodDescriptor;
  description?: string;
}

/**
 * Build an {@link ExtractionRecipe}; optional facts are attached only when
 * supplied so an absent fact stays absent (anti-fabrication).
 */
export function extractionRecipe(
  id: string,
  name: string,
  stages: ExtractionStage[],
  factTypes: ExtractionFactType[],
  options: ExtractionRecipeOptions = {},
): ExtractionRecipe {
  const recipe: ExtractionRecipe = { id, name, stages, factTypes };
  if (options.documentTypes !== undefined) recipe.documentTypes = options.documentTypes;
  if (options.fileFormats !== undefined) recipe.fileFormats = options.fileFormats;
  if (options.method !== undefined) recipe.method = options.method;
  if (options.description !== undefined) recipe.description = options.description;
  return recipe;
}

/** The canonical recipe's stable id. */
export const FOREVER_EXTRACTION_RECIPE_ID = "forever-extraction";

/**
 * Build *the* canonical Forever extraction recipe: how any catalogued source
 * is read into structured facts.
 *
 * Pure and deterministic: every call returns an equal, independent value with
 * no shared state. It deliberately restricts neither document type nor file
 * format and designates no method — which reading applies depends on the
 * source, and stating one here would fabricate a fact the recipe cannot know.
 * Its fact types are the full supported vocabulary, and the `record-attempt`
 * step is optional by contract: an attempt may legitimately be described
 * without being logged, so the fact stays absent rather than being
 * fabricated.
 */
export function foreverExtractionRecipe(): ExtractionRecipe {
  return extractionRecipe(
    FOREVER_EXTRACTION_RECIPE_ID,
    "Forever Extraction Recipe",
    [
      extractionStage("prepare", "Prepare", "prepare", [
        extractionStep("resolve-source", "Resolve the catalogued source", "source", {
          description: "Resolve the RC4.4 catalogued source the extraction reads.",
        }),
        extractionStep("pin-version", "Pin the received revision", "version", {
          description: "Pin the exact catalogued revision the extraction reads.",
        }),
        extractionStep("select-method", "Describe the extraction method", "method", {
          description: "Describe the method a runtime would apply to the source's file format.",
        }),
      ]),
      extractionStage("extract", "Extract", "extract", [
        extractionStep("locate-evidence", "Locate the evidence", "locate", {
          description:
            "Describe where in the source each fact would be observed: page, sheet, section, or frame.",
        }),
        extractionStep("describe-facts", "Describe the extracted facts", "extract", {
          description:
            "Describe the structured facts the source would produce, raw values preserved verbatim.",
        }),
      ]),
      extractionStage("assess", "Assess", "assess", [
        extractionStep("attach-provenance", "Attach the provenance chain", "annotate", {
          description:
            "Chain every described fact back to its source, revision, evidence, method, and caller-supplied time.",
        }),
        extractionStep("grade-confidence", "Attach the confidence", "annotate", {
          description:
            "Attach the caller-graded confidence; an unassessed confidence stays unknown.",
        }),
      ]),
      extractionStage("verify", "Verify", "verify", [
        extractionStep("validate-facts", "Validate the described facts", "validate", {
          description: "Run the module's validation pipeline over the described facts.",
        }),
        extractionStep("record-attempt", "Describe the attempt record", "record", {
          optional: true,
          description: "Describe the history entry the attempt would settle into.",
        }),
      ]),
    ],
    [...SUPPORTED_EXTRACTION_FACT_TYPES],
    {
      description:
        "How any catalogued Forever source is read into structured facts: resolve the source and revision, describe the method and evidence, describe the facts, chain their provenance, and validate the result.",
    },
  );
}
