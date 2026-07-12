/**
 * Forever Extraction Pipeline — the extraction provider contract.
 *
 * An {@link ExtractionProvider} is the reusable seam between a concrete
 * extraction pipeline and the registry: it exposes an
 * {@link ExtractionDefinition} that fully describes which sources the
 * pipeline reads and which fact types it produces, through which recipes.
 * RC4.5 defines the contract only; a future release implements it to plug a
 * specialised extractor into the registry without any existing code changing.
 *
 * Providers are pure descriptors: the contract exposes description, never
 * execution. Reading a file, applying an extraction method, producing a fact
 * value, and any IO live entirely outside this contract — mirroring the
 * Import (RC3.1), Sync (RC3.2), Source Registry (RC3.3), Connectors (RC3.4),
 * Pipeline (RC3.5), Project Integration (RC4.0), Project Template (RC4.2),
 * Project Factory (RC4.3), and Project Sources (RC4.4) provider contracts.
 */

import type { ProjectSourceDocumentType } from "@/features/forever-project-sources";

import type { ExtractionDefinition } from "../definition";
import type { ExtractionFactType } from "../facttype";
import {
  distinctExtractionDocumentTypes,
  extractionRecipeCount,
  extractionStepCount,
} from "../helpers";

/** The contract every extraction provider satisfies. */
export interface ExtractionProvider {
  /** The declarative description of the pipeline this provider represents. */
  readonly definition: ExtractionDefinition;
}

/**
 * Identity helper that pins an object to the {@link ExtractionProvider}
 * contract.
 *
 * Gives implementations full type-checking and inference without forcing a
 * class; the returned value is the provider unchanged.
 */
export function defineExtractionProvider<P extends ExtractionProvider>(provider: P): P {
  return provider;
}

/** Whether a provider's pipeline declares that it produces the given fact type. */
export function extractionProviderProduces(
  provider: ExtractionProvider,
  factType: ExtractionFactType,
): boolean {
  return provider.definition.factTypes.includes(factType);
}

/** Whether a provider's pipeline declares a recipe reading the given RC4.4 document type. */
export function extractionProviderReads(
  provider: ExtractionProvider,
  documentType: ProjectSourceDocumentType,
): boolean {
  return distinctExtractionDocumentTypes(provider.definition).includes(documentType);
}

/** The number of recipes a provider's pipeline declares. */
export function extractionProviderRecipeCount(provider: ExtractionProvider): number {
  return extractionRecipeCount(provider.definition);
}

/** The number of steps across every recipe of a provider's pipeline. */
export function extractionProviderStepCount(provider: ExtractionProvider): number {
  return extractionStepCount(provider.definition);
}
