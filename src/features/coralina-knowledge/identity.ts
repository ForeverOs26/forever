/**
 * Coralina Knowledge slice identity — deterministic, caller-stated constants.
 *
 * The RC4.4–RC4.9 foundations never read a wall clock; every timestamp they
 * stamp comes from the caller. The two instants below are the slice's stated
 * clock values, both anchored to committed repository facts rather than to
 * "now":
 *
 * - the extraction instant is the day the committed Coralina extraction
 *   package was generated (`forever-data/projects/coralina/import-status.json`
 *   → `generated_at: "2026-07-08"`),
 * - the description instant is the day this RC5.0 slice was authored.
 *
 * Rebuilding the slice therefore always yields byte-identical artifacts.
 */

export { CORALINA_SLUG, CORALINA_PROJECT_ID } from "@/features/coralina-integration";

/** When the committed Coralina extraction package was generated (real date). */
export const CORALINA_KNOWLEDGE_EXTRACTED_AT = "2026-07-08T00:00:00.000Z";

/** The slice's stated description clock (constant, so the build is reproducible). */
export const CORALINA_KNOWLEDGE_DESCRIBED_AT = "2026-07-13T00:00:00.000Z";

/** Committed datasets every slice value is transcribed from, for citation. */
export const CORALINA_DATASETS = {
  manifest: "forever-data/projects/coralina/manifest.json",
  importStatus: "forever-data/projects/coralina/import-status.json",
  brochure: "forever-data/projects/coralina/extracted/brochure.json",
  priceList: "forever-data/projects/coralina/extracted/price-list.json",
  masterplan: "forever-data/projects/coralina/extracted/masterplan.json",
  unitPlans: "forever-data/projects/coralina/extracted/unit-plans.json",
  verifiedFacts: "src/features/coralina-integration/data/coralina-facts.ts",
  officialEvidence: "forever-data/projects/coralina/evidence/rc5-4-evidence-review.json",
} as const;
