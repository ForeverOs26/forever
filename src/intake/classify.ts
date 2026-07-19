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

export interface Classification {
  category: IntakeCategory;
  extraction_support: IntakeExtractionSupport;
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
    test: (h) => h.includes("unit plan") || h.includes("unit-plan") || h.includes("unitplan"),
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

  // 1. Conventional source folder names (nearest folder first).
  for (const folder of [...folders].reverse()) {
    const match = FOLDER_RULES.find((rule) => rule.test(folder));
    if (match) {
      category = match.category;
      break;
    }
  }

  // 2. Keyword rules over the folder path, then the filename.
  if (!category) {
    const folderHay = folders.join("/");
    category = KEYWORD_RULES.find((rule) => rule.test(folderHay))?.category ?? null;
  }
  if (!category) {
    category = KEYWORD_RULES.find((rule) => rule.test(filename))?.category ?? null;
  }

  // 3. Extension fallback for unambiguous media/archive types.
  if (!category) {
    category = categoryFromExtension(extension);
  }

  return { category, extraction_support: supportFor(category, extension) };
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
