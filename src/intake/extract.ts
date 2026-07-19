/**
 * Fast Intake v1 — structured-artifact extraction (reuse, never OCR).
 *
 * Fast Intake consumes only recognized STRUCTURED artifacts already produced by
 * the existing extraction pipeline / operator preparation:
 *  - an extracted price list matching `ExtractedPriceList` (src/import/types),
 *    consumed verbatim by the existing Progressive builder;
 *  - a compact `project-facts.json` carrying identity facts with provenance.
 *
 * Raw PDFs, spreadsheets, images, and videos are inventoried and warned about,
 * never interpreted. No fact is ever invented from a filename.
 */

import { readFileSync } from "node:fs";

import type { ExtractedPriceList } from "@/import/types";

import type { PhysicalFile } from "./inventory";
import type { IntakeProjectFacts, IntakeWarning } from "./types";

export interface ExtractionResult {
  priceList: ExtractedPriceList | null;
  priceListLogicalPath: string | null;
  facts: IntakeProjectFacts;
  factsLogicalPath: string | null;
  warnings: IntakeWarning[];
}

function readJson(file: PhysicalFile): unknown {
  const text = readFileSync(file.absolutePath, "utf8").replace(/^\uFEFF/, "");
  try {
    return JSON.parse(text);
  } catch (error) {
    // A corrupt structured artifact fails closed: the run aborts before any
    // canonical output is written, preserving any previous valid payload.
    throw new Error(
      `intake_structured_artifact_unreadable: ${file.logicalPath} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
}

function pickPrimary(
  files: PhysicalFile[],
  warnings: IntakeWarning[],
  label: string,
): PhysicalFile | null {
  if (files.length === 0) return null;
  const sorted = [...files].sort((a, b) =>
    a.logicalPath < b.logicalPath ? -1 : a.logicalPath > b.logicalPath ? 1 : 0,
  );
  if (sorted.length > 1) {
    warnings.push({
      code: `multiple_${label}`,
      severity: "warning",
      message: `${sorted.length} ${label} artifacts found; using the first by path and ignoring the rest: ${sorted[0].logicalPath}`,
      logical_path: sorted[0].logicalPath,
    });
  }
  return sorted[0];
}

function isExtractedPriceList(value: unknown): value is ExtractedPriceList {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as Record<string, unknown>).unit_inventory)
  );
}

/** Extract the structured artifacts Fast Intake v1 knows how to consume. */
export function extractStructured(physicalFiles: PhysicalFile[]): ExtractionResult {
  const warnings: IntakeWarning[] = [];

  const priceListFiles = physicalFiles.filter(
    (file) => file.extractionSupport === "structured" && file.category === "price-list",
  );
  const factsFiles = physicalFiles.filter(
    (file) => file.extractionSupport === "structured" && file.category === "project-facts",
  );

  let priceList: ExtractedPriceList | null = null;
  let priceListLogicalPath: string | null = null;
  const priceListFile = pickPrimary(priceListFiles, warnings, "price-list");
  if (priceListFile) {
    const parsed = readJson(priceListFile);
    if (isExtractedPriceList(parsed)) {
      priceList = parsed;
      priceListLogicalPath = priceListFile.logicalPath;
    } else {
      warnings.push({
        code: "price_list_unreadable",
        severity: "warning",
        message: `Price-list artifact did not match the expected extracted shape; no units/prices were derived: ${priceListFile.logicalPath}`,
        logical_path: priceListFile.logicalPath,
      });
    }
  }

  let facts: IntakeProjectFacts = {};
  let factsLogicalPath: string | null = null;
  const factsFile = pickPrimary(factsFiles, warnings, "project-facts");
  if (factsFile) {
    const parsed = readJson(factsFile);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      facts = parsed as IntakeProjectFacts;
      factsLogicalPath = factsFile.logicalPath;
    } else {
      warnings.push({
        code: "project_facts_unreadable",
        severity: "warning",
        message: `project-facts artifact was not a JSON object; project identity was not enriched from it: ${factsFile.logicalPath}`,
        logical_path: factsFile.logicalPath,
      });
    }
  }

  return { priceList, priceListLogicalPath, facts, factsLogicalPath, warnings };
}
