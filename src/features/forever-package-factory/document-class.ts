/**
 * Package Factory — the Document Classifier.
 *
 * `src/intake/classify.ts` already routes a file by folder and filename. That
 * is necessary but not sufficient: a price list posted as `MOB - V.2.pdf` and a
 * brochure posted as `MOB - brochure.pdf` sit in the same folder, and a file
 * named "master plan" may in fact be the availability schedule drawn on the
 * master plan. So classification here combines:
 *
 *   filename + folder  (via classifyPath)
 *   document text      (first-page evidence, when a text layer exists)
 *   PDF metadata       (the /Title and /Subject strings)
 *   source location    (which adapter supplied it)
 *   dates              (publication date vs the document's own effective date)
 *
 * Text evidence outranks the filename, because the filename is the thing most
 * likely to be wrong. Nothing here proves a fact — classification only decides
 * which parser and which media slot a file is a candidate for.
 */

import { classifyPath } from "../../intake/classify";

import type { DocumentClass, ResolvedArtifact } from "./types";

export interface DocumentEvidence {
  /** Extracted text of the first page(s), lowercased. Empty when none. */
  text: string;
  /** PDF /Title and /Subject when present, lowercased. */
  metadata: string;
}

const EMPTY_EVIDENCE: DocumentEvidence = { text: "", metadata: "" };

/** Ordered text rules; first match wins. Applied to text, then metadata. */
const TEXT_RULES: ReadonlyArray<{ test: RegExp; documentClass: DocumentClass }> = [
  { test: /\bmaster\s*plan\b[\s\S]{0,80}\bprice\s*list\b/, documentClass: "availability_list" },
  { test: /\bprice\s*list\b[\s\S]{0,80}\bmaster\s*plan\b/, documentClass: "availability_list" },
  {
    test: /\bavailability\b|\bunit\s+status\b|\bsales\s+status\b/,
    documentClass: "availability_list",
  },
  {
    test: /\bprice\s*list\b|\bprice\s+schedule\b|\bselling\s+price\b|\bprice\s*\/\s*sqm\b/,
    documentClass: "price_list",
  },
  { test: /\bpayment\s+(plan|term|schedule)\b/, documentClass: "payment_plan" },
  {
    test: /\bfact\s*sheet\b|\bproject\s+guide\b|\bproject\s+information\b/,
    documentClass: "fact_sheet",
  },
  { test: /\bcompany\s+profile\b|\babout\s+the\s+developer\b/, documentClass: "company_profile" },
  { test: /\be-?brochure\b|\bbrochure\b/, documentClass: "project_brochure" },
  { test: /\bmaster\s*plan\b/, documentClass: "master_plan" },
  { test: /\bsite\s*plan\b/, documentClass: "site_plan" },
  { test: /\bunit\s*(plan|layout)\b/, documentClass: "unit_plan" },
  { test: /\bfloor\s*plan\b/, documentClass: "floor_plan" },
  { test: /\blocation\s*map\b|\bhow\s+to\s+get\b/, documentClass: "location_map" },
  { test: /\bpromotion\b|\bspecial\s+offer\b|\bdiscount\b/, documentClass: "promotion" },
  {
    test: /\bconstruction\s+(update|progress)\b|\bproject\s+progress\b/,
    documentClass: "construction_update",
  },
];

/** Category from the shared routing classifier → a Factory document class. */
function fromRoutingCategory(path: string): DocumentClass {
  switch (classifyPath(path).category) {
    case "price-list":
      return "price_list";
    case "payment-plan":
      return "payment_plan";
    case "brochure":
      return "project_brochure";
    case "developer-profile":
      return "company_profile";
    case "project-facts":
      return "fact_sheet";
    case "master-plan":
      return "master_plan";
    case "floor-plan":
      return "floor_plan";
    case "unit-plan":
      return "unit_plan";
    case "map-location":
      return "location_map";
    case "photo":
      return "photo";
    case "video":
      return "video";
    default:
      return "other_official_document";
  }
}

/** Leading bytes say PDF? Only then is text/metadata evidence meaningful. */
export function isPdf(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

/**
 * PDF /Title and /Subject, read from the raw bytes.
 *
 * Deliberately shallow: this reads the literal strings a producer writes into
 * the document information dictionary and never decompresses an object stream,
 * so a malformed or hostile file cannot cost more than a regex over a bounded
 * prefix.
 */
export function pdfMetadataStrings(bytes: Buffer): string {
  if (!isPdf(bytes)) return "";
  const head = bytes.subarray(0, Math.min(bytes.length, 512 * 1024)).toString("latin1");
  const found: string[] = [];
  for (const key of ["Title", "Subject", "Keywords"]) {
    const match = new RegExp(`/${key}\\s*\\(([^)\\\\]{0,300})\\)`).exec(head);
    if (match) found.push(match[1]);
  }
  return found.join(" ").toLowerCase();
}

/**
 * Classify one artifact.
 *
 * `evidence.text` is supplied by the caller (the PDF text layer, or a decoded
 * text file) so this stays a pure function and the expensive extraction happens
 * once per artifact.
 */
export function classifyDocument(
  artifact: Pick<ResolvedArtifact, "logicalPath" | "ref" | "bytes">,
  evidence: DocumentEvidence = EMPTY_EVIDENCE,
): DocumentClass {
  const routed = fromRoutingCategory(artifact.logicalPath);

  // An image or a video is settled by its bytes; text rules do not apply.
  if (routed === "photo" || routed === "video") return routed;

  const haystacks = [evidence.text, evidence.metadata].filter(Boolean);
  for (const haystack of haystacks) {
    const match = TEXT_RULES.find((rule) => rule.test.test(haystack));
    if (match) return match.documentClass;
  }

  // No usable content evidence: fall back to the routing decision, then to the
  // filename rules (which routing already applied), then to "other".
  return routed;
}

/** Document classes the price/availability parsers should be offered. */
export const PRICE_BEARING_CLASSES: ReadonlySet<DocumentClass> = new Set([
  "price_list",
  "availability_list",
]);
