/**
 * Fast Intake v1 — deterministic project-material classifier.
 *
 * Routing only. A file is classified from its containing folder, filename
 * keywords, and extension — never from its contents, and never as proof of a
 * fact. Classification decides how a file is routed and which warnings apply;
 * facts come exclusively from parsed structured artifacts (see extract.ts).
 */

import { extname } from "node:path";

import type { IntakeCategory, IntakeExtractionSupport } from "./types";

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".heic",
  ".heif",
  ".avif",
  ".bmp",
  ".tif",
  ".tiff",
]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);
const ARCHIVE_EXTENSIONS = new Set([".zip", ".rar", ".7z", ".tar", ".gz", ".tgz"]);
const DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".txt",
  ".rtf",
  ".url",
]);

/**
 * WHICH rule decided the category.
 *
 * `folder` and `keyword` are signals the material itself carries — someone
 * named that folder or that file. `extension` is the weakest: it knows the file
 * is a picture or a document and nothing more. `none` is `unknown`.
 *
 * Callers that let a weaker signal (a chat caption) re-route a file need this
 * to tell "a document called contract.pdf" from "some PDF", which the category
 * alone cannot express.
 */
export type ClassificationSource = "folder" | "keyword" | "extension" | "none";

export interface Classification {
  category: IntakeCategory;
  extraction_support: IntakeExtractionSupport;
  /** Which rule decided `category`. */
  matched_by: ClassificationSource;
}

/** Ordered keyword → category rules; first match wins. Applied to folder path and filename. */
const KEYWORD_RULES: ReadonlyArray<{
  test: (haystack: string) => boolean;
  category: IntakeCategory;
}> = [
  {
    test: (h) => h.includes("payment") && (h.includes("plan") || h.includes("term")),
    category: "payment-plan",
  },
  { test: (h) => h.includes("price") && h.includes("list"), category: "price-list" },
  { test: (h) => h.includes("pricelist"), category: "price-list" },
  {
    test: (h) => h.includes("project-facts") || h.includes("project_facts"),
    category: "project-facts",
  },
  { test: (h) => h.includes("identity") || h.includes("facts"), category: "project-facts" },
  { test: (h) => h.includes("brochure") || h.includes("e-brochure"), category: "brochure" },
  {
    test: (h) =>
      h.includes("company profile") || h.includes("company-profile") || h.includes("developer"),
    category: "developer-profile",
  },
  {
    test: (h) => h.includes("masterplan") || h.includes("master plan") || h.includes("master-plan"),
    category: "master-plan",
  },
  {
    // A villa project calls its unit plan a house plan; both are the layout of
    // one home. Without this, Villa Kirara's "5. House Plan" sheets classified
    // as photographs and one of them became a candidate for the project cover.
    test: (h) =>
      h.includes("unit plan") ||
      h.includes("unit-plan") ||
      h.includes("unitplan") ||
      h.includes("house plan") ||
      h.includes("house-plan") ||
      h.includes("houseplan"),
    category: "unit-plan",
  },
  { test: (h) => h.includes("floor") && h.includes("plan"), category: "floor-plan" },
  {
    test: (h) => h.includes("furniture") || h.includes("ff&e") || h.includes("ffe"),
    category: "furniture-package",
  },
  { test: (h) => h.includes("map") || h.includes("location"), category: "map-location" },
  {
    test: (h) =>
      h.includes("legal") ||
      h.includes("contract") ||
      h.includes("agreement") ||
      h.includes("title deed") ||
      h.includes("document"),
    category: "legal-document",
  },
];

/** Folder-name → category for the conventional Forever source folders. */
const FOLDER_RULES: ReadonlyArray<{ test: (folder: string) => boolean; category: IntakeCategory }> =
  [
    { test: (f) => f === "price-list" || f === "prices", category: "price-list" },
    { test: (f) => f === "payment-plan" || f === "payment-plans", category: "payment-plan" },
    { test: (f) => f === "brochure" || f === "brochures", category: "brochure" },
    { test: (f) => f === "facts" || f === "identity", category: "project-facts" },
    { test: (f) => f === "masterplan" || f === "master-plan", category: "master-plan" },
    {
      test: (f) => f === "unit-plans" || f === "unit-plan" || f === "unitplans",
      category: "unit-plan",
    },
    { test: (f) => f === "floor-plans" || f === "floorplans", category: "floor-plan" },
    { test: (f) => f === "furniture" || f === "furniture-package", category: "furniture-package" },
    { test: (f) => f === "map" || f === "maps", category: "map-location" },
    {
      test: (f) => f === "images" || f === "photos" || f === "renders" || f === "gallery",
      category: "photo",
    },
    { test: (f) => f === "videos" || f === "video", category: "video" },
    { test: (f) => f === "documents" || f === "docs" || f === "legal", category: "legal-document" },
  ];

function categoryFromExtension(extension: string): IntakeCategory {
  if (IMAGE_EXTENSIONS.has(extension)) return "photo";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
  // A document whose folder and filename say nothing is still, definitely, a
  // document. Leaving it `unknown` was the reason official material — a
  // facilities deck, a living-services brochure — disappeared into
  // "unrecognized" with no category at all.
  //
  // `legal-document` is the CONSERVATIVE landing place, not a claim about
  // content: it is the one document category with no public media type, so the
  // file is inventoried and retained privately rather than published. A
  // document that really is a brochure, price list or plan was already routed
  // by the folder and keyword rules above, which run first.
  if (DOCUMENT_EXTENSIONS.has(extension)) return "legal-document";
  return "unknown";
}

/**
 * Classify a logical (root-relative, forward-slash) path deterministically.
 * Precedence: folder-name convention → keyword (folder path, then filename) →
 * extension → unknown. Category never proves a fact.
 */
export function classifyPath(logicalPath: string): Classification {
  const parts = logicalPath.split("/").filter(Boolean);
  const filename = (parts[parts.length - 1] ?? "").toLowerCase();
  const folders = parts.slice(0, -1).map((segment) => segment.toLowerCase());
  const extension = extname(filename);

  let category: IntakeCategory | null = null;
  let matchedBy: ClassificationSource = "none";

  // 1. Conventional source folder names (nearest folder first).
  for (const folder of [...folders].reverse()) {
    const match = FOLDER_RULES.find((rule) => rule.test(folder));
    if (match) {
      category = match.category;
      matchedBy = "folder";
      break;
    }
  }

  // 2. Keyword rules over the folder path, then the filename.
  if (!category) {
    const folderHay = folders.join("/");
    category = KEYWORD_RULES.find((rule) => rule.test(folderHay))?.category ?? null;
    if (category) matchedBy = "keyword";
  }
  if (!category) {
    category = KEYWORD_RULES.find((rule) => rule.test(filename))?.category ?? null;
    if (category) matchedBy = "keyword";
  }

  // 3. Extension fallback for unambiguous media/archive/document types.
  if (!category) {
    category = categoryFromExtension(extension);
    if (category !== "unknown") matchedBy = "extension";
  }

  return {
    category,
    extraction_support: supportFor(category, extension),
    matched_by: matchedBy,
  };
}

/**
 * Extraction support:
 *  - `structured`  a `.json` price list or project-facts file we consume;
 *  - `inventoried` any other recognized source (raw or non-consumed json);
 *  - `unsupported` an unknown file (never blocking).
 */
export function supportFor(category: IntakeCategory, extension: string): IntakeExtractionSupport {
  if (category === "unknown") return "unsupported";
  if (extension === ".json" && (category === "price-list" || category === "project-facts")) {
    return "structured";
  }
  return "inventoried";
}
