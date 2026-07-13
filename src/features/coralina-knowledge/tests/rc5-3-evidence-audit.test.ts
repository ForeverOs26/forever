import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { currentProjectFieldValue, findProjectField } from "@/features/forever-project-database";
import { listReadinessBlockers } from "@/features/forever-project-readiness";

import { CORALINA_EXTRACTION_FACTS } from "../facts";
import { buildCoralinaKnowledgeSlice } from "../slice";

const root = join(process.cwd(), "forever-data", "projects", "coralina");
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

describe("RC5.4 Coralina official-source evidence resolution", () => {
  it("records verified manifest and extracted values with official provenance", () => {
    const manifest = readJson("manifest.json");
    const brochure = readJson("extracted/brochure.json");
    expect(manifest.developer).toBe("Rhom Bho Property Public Company Limited");
    expect(manifest.country).toBe("Thailand");
    expect(brochure.developer.value).toBe(manifest.developer);
    expect(brochure.location.country.value).toBe(manifest.country);
    expect(brochure.developer.source_file).toContain("market.sec.or.th");
  });

  it("marks the package ready for dry-run with no mandatory blockers", () => {
    const status = readJson("import-status.json");
    expect(status.ready_for_import).toBe(true);
    expect(status.mandatory_metadata_review.still_blocked).toEqual([]);
  });

  it("states and materialises developer and country without readiness blockers", () => {
    const paths = new Set(CORALINA_EXTRACTION_FACTS.map((fact) => fact.fieldPath));
    expect(paths.has("developer.name")).toBe(true);
    expect(paths.has("location.country")).toBe(true);
    const slice = buildCoralinaKnowledgeSlice();
    expect(
      currentProjectFieldValue(findProjectField(slice.canonical.record, "developer.name")!)
        ?.rawValue,
    ).toBe("Rhom Bho Property Public Company Limited");
    expect(
      currentProjectFieldValue(findProjectField(slice.canonical.record, "location.country")!)
        ?.rawValue,
    ).toBe("Thailand");
    expect(slice.readiness.report.standing).toBe("ready");
    expect(listReadinessBlockers(slice.readiness.report)).toEqual([]);
  });

  it("preserves the remaining non-blocking gaps and unit-type dispute", () => {
    const slice = buildCoralinaKnowledgeSlice();
    expect(slice.gaps.map((gap) => gap.path)).toEqual([
      "location.coordinates",
      "construction.status",
      "legal.ownershipType",
      "pricing.currency",
    ]);
    expect(findProjectField(slice.canonical.record, "units.unitTypes")).toBeUndefined();
  });
});
