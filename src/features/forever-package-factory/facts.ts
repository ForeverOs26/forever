/**
 * Package Factory — deterministic fact extraction.
 *
 * Only facts a source actually states become facts. There is no inference step,
 * no default and no "reasonable assumption": a field with no evidence stays
 * null, which the publish lane already handles as a non-blocking warning.
 *
 * What is extracted:
 *   - the project name as printed in the heading of an official schedule;
 *   - the effective date the document states about itself;
 *   - the currency the document evidences;
 *   - the developer and area, but only from the Owner's own hint (a marketing
 *     page or a filename is not evidence of a developer).
 */

import type { FieldProvenanceMap } from "../forever-ingestion/provenance";

import type { ProjectHint } from "./source-set";

/** Heading words that surround a project name in an official schedule. */
const HEADING_NOISE =
  /\b(price\s*list|pricelist|price\s*schedule|availability|master\s*plan|updated|internal\s+use\s+only|for\s+agents?)\b/gi;

/**
 * Read the project name from a document heading.
 *
 * The first non-empty line of these schedules is "CORALINA Price List - Updated
 * : 17.07.26 (Internal Use Only)". Stripping the known heading vocabulary,
 * dates and bracketed notes leaves the project name. Returns null rather than a
 * guess when what remains is too short or is only punctuation.
 */
export function projectNameFromHeading(text: string): string | null {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\f/g, "").trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;

  const cleaned = firstLine
    .replace(/\([^)]*\)/g, " ")
    .replace(HEADING_NOISE, " ")
    .replace(/\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b/g, " ")
    .replace(/\bV\.?\s?\d+\b/gi, " ")
    .replace(/[:\-–—|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < 3) return null;
  if (!/[A-Za-z]/.test(cleaned)) return null;
  // A heading that survived as a single generic word is not a project name.
  if (/^(the|price|list|units?)$/i.test(cleaned)) return null;
  return titleCase(cleaned);
}

/** "THE MODEVA" → "The Modeva"; leaves mixed-case input alone. */
export function titleCase(value: string): string {
  if (value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** The effective date a document states about itself, if any. */
export function effectiveDateFromText(text: string): string | null {
  const head = text.slice(0, 4000);
  const match =
    /\b(?:updated|effective|as\s+of|valid\s+from)\s*:?\s*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\b/i.exec(
      head,
    );
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const yearRaw = match[3];
  const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface ExtractedFacts {
  /** Names observed in official documents, best first. */
  documentNames: string[];
  /** Effective dates stated inside documents, by artifact ref. */
  effectiveDates: Record<string, string>;
  developer: string | null;
  area: string | null;
}

export function extractFacts(
  documents: ReadonlyArray<{ ref: string; text: string }>,
  hint: ProjectHint | undefined,
): ExtractedFacts {
  const documentNames: string[] = [];
  const effectiveDates: Record<string, string> = {};

  for (const document of documents) {
    const name = projectNameFromHeading(document.text);
    if (name && !documentNames.includes(name)) documentNames.push(name);
    const date = effectiveDateFromText(document.text);
    if (date) effectiveDates[document.ref] = date;
  }

  return {
    documentNames,
    effectiveDates,
    developer: hint?.developer?.trim() || null,
    area: hint?.area?.trim() || null,
  };
}

/**
 * Field provenance for the project columns the Factory writes.
 *
 * The publish lane requires at least one source reference before it will make a
 * public record, and provenance is where that evidence lives. Refs are
 * public-safe basenames; a local path or a channel invite never appears here.
 */
export function buildFieldProvenance(input: {
  fields: readonly string[];
  sourceRef: string;
  sourceType: string;
  /** The document's own effective date, when it states one. */
  sourceDate: string | null;
}): FieldProvenanceMap {
  const provenance: FieldProvenanceMap = {};
  for (const field of input.fields) {
    provenance[field] = {
      // An Owner-supplied developer document is an official source. It is NOT
      // `owner_verified`: that status is reserved for a deliberate verification
      // action and must never be assigned by routine ingestion.
      status: "official_source",
      source_type: input.sourceType,
      source_ref: input.sourceRef,
      ...(input.sourceDate ? { source_date: input.sourceDate } : {}),
    };
  }
  return provenance;
}
