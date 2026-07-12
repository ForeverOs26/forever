/**
 * Forever Extraction Pipeline — the extraction definition and the canonical
 * pipeline.
 *
 * An {@link ExtractionDefinition} is the complete, declarative description of
 * one extraction pipeline: its identity and version, the ordered
 * {@link ExtractionRecipe}s it can follow, the fact types its facts cover,
 * the optional behavioural policy that governs it, and optional descriptive
 * metadata. It is the unit the registry stores and the validation pipeline
 * judges — the standard description of how any registered Forever source
 * produces structured extracted facts, expressed entirely as data.
 *
 * {@link buildForeverExtractionPipeline} returns *the* canonical pipeline:
 * one recipe (the canonical Forever extraction recipe) covering the full
 * supported fact-type vocabulary under the reused RC4.0 safe default policy.
 * It is a pure factory — it reads no clock and holds no shared state, so
 * every call returns an equal, independent value that is safe to mutate,
 * diff, register, and validate.
 */

import type { ExtractionFactType } from "./facttype";
import { SUPPORTED_EXTRACTION_FACT_TYPES } from "./facttype";
import { deriveExtractionIdentity, extractionIdForSlug, type ExtractionIdentity } from "./identity";
import { defaultExtractionPolicy, type ExtractionPolicy } from "./policy";
import { foreverExtractionRecipe, type ExtractionRecipe } from "./recipe";
import type { ExtractionId, ExtractionMetadata } from "./types";
import { extractionVersion, type ExtractionVersion } from "./version";

/** The full declarative description of one extraction pipeline. */
export interface ExtractionDefinition {
  identity: ExtractionIdentity;
  version: ExtractionVersion;
  /** The ordered recipes this pipeline can follow; the first is its default. */
  recipes: ExtractionRecipe[];
  /** The fact types this pipeline's facts cover, in declared order. */
  factTypes: ExtractionFactType[];
  /** Optional behavioural contract governing planned extractions. */
  policy?: ExtractionPolicy;
  metadata?: ExtractionMetadata;
}

/**
 * Identity helper that pins an object to the {@link ExtractionDefinition}
 * shape.
 *
 * Gives call sites full type-checking and inference without forcing a
 * factory; the returned value is the definition unchanged.
 */
export function defineExtraction(definition: ExtractionDefinition): ExtractionDefinition {
  return definition;
}

/**
 * The canonical pipeline's stable id: `extr_forever-extraction`.
 *
 * Derived through the module's own {@link extractionIdForSlug} rule (never a
 * hand-written parallel form), so the constant and the derivation path can
 * never mint two different ids for the same slug.
 */
export const FOREVER_EXTRACTION_PIPELINE_ID: ExtractionId =
  extractionIdForSlug("forever-extraction");

/**
 * The canonical pipeline identity, derived through the module's own
 * {@link deriveExtractionIdentity} rule so it is byte-identical to what any
 * caller would derive from the canonical slug.
 */
export function foreverExtractionIdentity(): ExtractionIdentity {
  return deriveExtractionIdentity("forever-extraction", {
    name: "Forever Extraction Pipeline",
  });
}

/**
 * Build *the* canonical Forever extraction pipeline.
 *
 * Pure and deterministic: every call returns an equal, independent value with
 * no shared state, so it is always safe to mutate, diff, register, and
 * validate.
 */
export function buildForeverExtractionPipeline(): ExtractionDefinition {
  return defineExtraction({
    identity: foreverExtractionIdentity(),
    version: extractionVersion(0, 1, 0),
    recipes: [foreverExtractionRecipe()],
    factTypes: [...SUPPORTED_EXTRACTION_FACT_TYPES],
    policy: defaultExtractionPolicy(),
    metadata: {
      description:
        "Standard description of how any registered Forever source produces structured extracted facts: provide a catalogued source and the observations a reading proves, the pipeline describes everything else.",
      owner: "Forever intake",
      tags: ["extraction", "rc4.5"],
    },
  });
}
