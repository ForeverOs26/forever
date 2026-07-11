/**
 * Forever Import — the adapter contract.
 *
 * An {@link ImportAdapter} is the seam between a raw source format and the
 * canonical Forever records. RC3.1 defines the contract only; later releases
 * implement it for PDF, Excel, CSV, JSON, Website, CRM, and Manual sources.
 *
 * Adapters are pure and deterministic: they receive input that has *already*
 * been extracted (bytes read, HTML fetched, rows parsed) and map it to canonical
 * records. Extraction — IO, HTTP, scraping, byte-level parsing — lives entirely
 * outside this contract, so an adapter is trivially unit-testable.
 */

import type { ImportContext, ImportFormat, ImportResult, ImportSourceKind } from "../types";

/**
 * Already-extracted, structured input handed to an adapter.
 *
 * Intentionally `unknown`: each concrete adapter narrows it to the shape its
 * format produces (a parsed CSV row array, a JSON object, a DOM snapshot). The
 * foundation makes no assumption about it and never dereferences a network
 * resource to obtain it.
 */
export type RawImportInput = unknown;

/**
 * Maps raw source input of one {@link ImportFormat} into canonical records.
 *
 * @typeParam T - the canonical Forever entity the adapter emits.
 */
export interface ImportAdapter<T> {
  /** The source format this adapter understands. */
  readonly format: ImportFormat;
  /** The canonical entity kind this adapter produces. */
  readonly kind: ImportSourceKind;
  /**
   * Transform extracted input into an {@link ImportResult}. Must be pure: no
   * IO, no clock, no randomness — identical `(input, context)` yields identical
   * output.
   */
  adapt(input: RawImportInput, context: ImportContext): ImportResult<T>;
}

/**
 * Identity helper that pins an object to the {@link ImportAdapter} contract.
 *
 * Gives implementations full type-checking and inference without forcing a
 * class; the returned value is the adapter unchanged.
 */
export function defineImportAdapter<T>(adapter: ImportAdapter<T>): ImportAdapter<T> {
  return adapter;
}
