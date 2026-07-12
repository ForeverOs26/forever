/**
 * Forever Extraction Pipeline — the extraction method descriptor.
 *
 * An {@link ExtractionMethodDescriptor} names *how* a future runtime would
 * read a source: by hand, by PDF text, by OCR, by spreadsheet cells, by image
 * or video analysis, by capturing a web page, by an API payload, or with AI
 * assistance. The vocabulary is closed and includes an explicit `"unknown"`
 * so a method that cannot yet be classified is represented rather than
 * dropped (anti-fabrication).
 *
 * These are descriptors only. RC4.5 implements none of these methods — no OCR
 * engine, PDF parser, spreadsheet reader, recognizer, scraper, or model call
 * exists here. The descriptor is what makes every fact's provenance say which
 * kind of reading produced it, before any reader is ever built.
 */

/** The closed vocabulary of ways a future runtime could read a source. */
export type ExtractionMethodKind =
  | "manual"
  | "pdf_text"
  | "ocr"
  | "spreadsheet"
  | "image_analysis"
  | "video_analysis"
  | "web_capture"
  | "api_payload"
  | "ai_assisted"
  | "unknown";

/** Every {@link ExtractionMethodKind}, in a stable declared order. */
export const EXTRACTION_METHOD_KINDS = [
  "manual",
  "pdf_text",
  "ocr",
  "spreadsheet",
  "image_analysis",
  "video_analysis",
  "web_capture",
  "api_payload",
  "ai_assisted",
  "unknown",
] as const satisfies readonly ExtractionMethodKind[];

/** Runtime guard: whether a value is a known {@link ExtractionMethodKind}. */
export function isKnownExtractionMethodKind(value: unknown): value is ExtractionMethodKind {
  return (
    typeof value === "string" && (EXTRACTION_METHOD_KINDS as readonly string[]).includes(value)
  );
}

/** How a future runtime would read a source. A description, never a reader. */
export interface ExtractionMethodDescriptor {
  kind: ExtractionMethodKind;
  /** The named tool or path a runtime would use, when one is designated. */
  tool?: string;
  /** Free-text description of how the method would be applied. */
  description?: string;
}

/** Options accepted by {@link extractionMethod}. */
export interface ExtractionMethodOptions {
  tool?: string;
  description?: string;
}

/**
 * Build an {@link ExtractionMethodDescriptor}; optional facts are attached
 * only when supplied so an absent fact stays absent (anti-fabrication).
 */
export function extractionMethod(
  kind: ExtractionMethodKind,
  options: ExtractionMethodOptions = {},
): ExtractionMethodDescriptor {
  const method: ExtractionMethodDescriptor = { kind };
  if (options.tool !== undefined) method.tool = options.tool;
  if (options.description !== undefined) method.description = options.description;
  return method;
}
