/**
 * Forever Extraction Pipeline — extraction provenance.
 *
 * An {@link ExtractionProvenance} is the mandatory chain that makes every fact
 * traceable: back to the registered RC4.4 source (by id, reused directly),
 * the exact received revision (the reused RC4.4 version shape), the
 * {@link ExtractionMethodDescriptor} that names how the reading would have
 * been performed, and the caller-supplied extraction time — RC4.5 reads no
 * clock, so a timestamp only ever appears because a caller proved one. The
 * optional recipe and step ids pin which declared part of a definition the
 * attempt followed, and `derivedFrom` chains a derived fact back through the
 * facts it was computed from — described here, never computed.
 *
 * This is deliberately richer than — and distinct from — the additive RC3.0
 * `SourceMetadata` annotation on canonical records: there provenance is
 * optional colour, here it is the contract. A fact without provenance is
 * reported as incoherent by validation, never repaired.
 */

import type { ISODateTime } from "@/features/forever-database";
import type { ProjectSourceId } from "@/features/forever-project-sources";

import type { ExtractionMethodDescriptor } from "./method";
import type { ExtractionFactId } from "./types";
import type { ExtractionSourceVersion } from "./version";

/** The mandatory chain from one fact back to where and how it was read. */
export interface ExtractionProvenance {
  /** The RC4.4 catalogued source the fact was extracted from. Reused directly. */
  sourceId: ProjectSourceId;
  /** The received revision the fact was extracted from. Reused RC4.4 shape. */
  sourceVersion: ExtractionSourceVersion;
  /** How the reading would have been performed. A descriptor, never a reader. */
  method: ExtractionMethodDescriptor;
  /** When the extraction happened, supplied by the caller — never a clock read. */
  extractedAt: ISODateTime;
  /** The recipe the attempt followed, when one was resolved. */
  recipeId?: string;
  /** The step of that recipe the fact was produced by, when one was resolved. */
  stepId?: string;
  /** The facts a derived fact was computed from, in declared order. */
  derivedFrom?: ExtractionFactId[];
}

/** Options accepted by {@link extractionProvenance}. */
export interface ExtractionProvenanceOptions {
  recipeId?: string;
  stepId?: string;
  derivedFrom?: ExtractionFactId[];
}

/**
 * Build an {@link ExtractionProvenance}; optional links are attached only when
 * supplied so an absent fact stays absent (anti-fabrication).
 */
export function extractionProvenance(
  sourceId: ProjectSourceId,
  sourceVersion: ExtractionSourceVersion,
  method: ExtractionMethodDescriptor,
  extractedAt: ISODateTime,
  options: ExtractionProvenanceOptions = {},
): ExtractionProvenance {
  const provenance: ExtractionProvenance = { sourceId, sourceVersion, method, extractedAt };
  if (options.recipeId !== undefined) provenance.recipeId = options.recipeId;
  if (options.stepId !== undefined) provenance.stepId = options.stepId;
  if (options.derivedFrom !== undefined) provenance.derivedFrom = options.derivedFrom;
  return provenance;
}

/**
 * The derivation chain a provenance declares: the fact ids a derived fact was
 * computed from, in declared order with duplicates removed. Empty for a fact
 * read directly off its source. Pure and immutable — the provenance is never
 * mutated.
 */
export function extractionProvenanceChain(provenance: ExtractionProvenance): ExtractionFactId[] {
  const seen = new Set<ExtractionFactId>();
  const chain: ExtractionFactId[] = [];
  for (const id of provenance.derivedFrom ?? []) {
    if (!seen.has(id)) {
      seen.add(id);
      chain.push(id);
    }
  }
  return chain;
}
