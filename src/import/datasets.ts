import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getProjectRoot } from "./manifest";
import type { ExtractedDatasets, ExtractedPriceList } from "./types";

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function loadExtractedDatasets(
  projectSlug: string,
  projectsRoot: string,
): Promise<ExtractedDatasets> {
  const projectRoot = getProjectRoot(projectSlug, projectsRoot);
  const extractedRoot = join(projectRoot, "extracted");

  return {
    brochure: await readJsonIfExists(join(extractedRoot, "brochure.json")),
    priceList: await readJsonIfExists<ExtractedPriceList>(join(extractedRoot, "price-list.json")),
    masterplan: await readJsonIfExists(join(extractedRoot, "masterplan.json")),
    unitPlans: await readJsonIfExists(join(extractedRoot, "unit-plans.json")),
    images: await readJsonIfExists(join(extractedRoot, "images.json")),
    documents: await readJsonIfExists(join(extractedRoot, "documents.json")),
  };
}
