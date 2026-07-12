/**
 * Forever Extraction Pipeline — extraction evidence.
 *
 * An {@link ExtractionEvidence} says *where* a fact was observed: which
 * catalogued RC4.4 source (by id, reused directly — never a parallel
 * reference), which received revision of it, and the location inside it — a
 * page, a sheet, a section, a video frame, a cell, a region, or explicitly
 * the whole document. The optional excerpt preserves the observed text
 * verbatim so a reviewer can check the reading without re-opening the source.
 *
 * Every field is caller-supplied and attached only when known — RC4.5 opens
 * no file and reads no byte, so it can never observe a location itself, and
 * an unknown location stays absent rather than being fabricated. The locator
 * vocabulary is closed, with `"document"` for facts evidenced by the source
 * as a whole and `"unknown"` for a location that cannot yet be classified.
 */

import type { ProjectSourceId } from "@/features/forever-project-sources";

import type { ExtractionSourceVersion } from "./version";

/** The kind of place inside a source a fact was observed at. */
export type ExtractionLocatorKind =
  | "document"
  | "page"
  | "sheet"
  | "section"
  | "frame"
  | "cell"
  | "region"
  | "unknown";

/** Every {@link ExtractionLocatorKind}, in a stable declared order. */
export const EXTRACTION_LOCATOR_KINDS = [
  "document",
  "page",
  "sheet",
  "section",
  "frame",
  "cell",
  "region",
  "unknown",
] as const satisfies readonly ExtractionLocatorKind[];

/** Runtime guard: whether a value is a known {@link ExtractionLocatorKind}. */
export function isKnownExtractionLocatorKind(value: unknown): value is ExtractionLocatorKind {
  return (
    typeof value === "string" && (EXTRACTION_LOCATOR_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Where inside a source a fact was observed. Each optional field is attached
 * only where applicable: a page number for paged documents, a sheet name for
 * spreadsheets, a section label for prose, a frame index for video, and a
 * free-text detail for anything finer (e.g. `row 12, column C`).
 */
export interface ExtractionLocator {
  kind: ExtractionLocatorKind;
  /** 1-based page number, when the source is paged. */
  page?: number;
  /** Sheet name, when the source is a workbook. */
  sheet?: string;
  /** Section heading or label, when the source is sectioned. */
  section?: string;
  /** 0-based frame index, when the source is a video. */
  frame?: number;
  /** Free-text refinement of the location. */
  detail?: string;
}

/** Options accepted by {@link extractionLocator}. */
export interface ExtractionLocatorOptions {
  page?: number;
  sheet?: string;
  section?: string;
  frame?: number;
  detail?: string;
}

/**
 * Build an {@link ExtractionLocator}; optional facts are attached only when
 * supplied so an absent location detail stays absent (anti-fabrication).
 */
export function extractionLocator(
  kind: ExtractionLocatorKind,
  options: ExtractionLocatorOptions = {},
): ExtractionLocator {
  const locator: ExtractionLocator = { kind };
  if (options.page !== undefined) locator.page = options.page;
  if (options.sheet !== undefined) locator.sheet = options.sheet;
  if (options.section !== undefined) locator.section = options.section;
  if (options.frame !== undefined) locator.frame = options.frame;
  if (options.detail !== undefined) locator.detail = options.detail;
  return locator;
}

/** Where one fact was observed: the catalogued source, revision, and location. */
export interface ExtractionEvidence {
  /** The RC4.4 catalogued source the fact was observed in. Reused directly. */
  sourceId: ProjectSourceId;
  /** The received revision the observation was made in, when pinned. */
  sourceVersion?: ExtractionSourceVersion;
  /** The location inside the source, when one is known. */
  locator?: ExtractionLocator;
  /** The observed text, preserved verbatim — never normalized here. */
  excerpt?: string;
}

/** Options accepted by {@link extractionEvidence}. */
export interface ExtractionEvidenceOptions {
  sourceVersion?: ExtractionSourceVersion;
  locator?: ExtractionLocator;
  excerpt?: string;
}

/**
 * Build an {@link ExtractionEvidence}; optional facts are attached only when
 * supplied so an absent fact stays absent (anti-fabrication).
 */
export function extractionEvidence(
  sourceId: ProjectSourceId,
  options: ExtractionEvidenceOptions = {},
): ExtractionEvidence {
  const evidence: ExtractionEvidence = { sourceId };
  if (options.sourceVersion !== undefined) evidence.sourceVersion = options.sourceVersion;
  if (options.locator !== undefined) evidence.locator = options.locator;
  if (options.excerpt !== undefined) evidence.excerpt = options.excerpt;
  return evidence;
}
