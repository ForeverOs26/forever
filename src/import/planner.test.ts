import { describe, expect, it } from "vitest";

import { loadExtractedDatasets } from "./datasets";
import { loadManifest } from "./manifest";
import { fingerprintImportPlan } from "./plan-hash";
import { canonicalSourceFilename, createImportPlan } from "./planner";
import { buildServerExecutionRequest, isSafeSourceFileName } from "./server-execution-request";
import { validateProjectImport } from "./validator";

const PROJECTS_ROOT = "forever-data/projects";
const CORALINA_SOURCE_PATH =
  "forever-data/projects/coralina/source/price-list/CLK - Price List V.2. - Updated 03.07.26.pdf";
const CORALINA_SOURCE_FILENAME = "CLK - Price List V.2. - Updated 03.07.26.pdf";

describe("canonical import source filenames", () => {
  it("extracts a deterministic filename and rejects an empty basename", () => {
    expect(canonicalSourceFilename("directory/price-list.pdf")).toBe("price-list.pdf");
    expect(canonicalSourceFilename("directory\\price-list.pdf")).toBe("price-list.pdf");
    expect(() => canonicalSourceFilename("directory/")).toThrow(
      "source_file_canonicalization_failed",
    );
  });

  it("keeps Coralina provenance while emitting only safe canonical source_file values", async () => {
    const manifest = await loadManifest("coralina", PROJECTS_ROOT);
    const datasets = await loadExtractedDatasets("coralina", PROJECTS_ROOT);
    const validation = await validateProjectImport(manifest, PROJECTS_ROOT);
    const plan = createImportPlan(manifest, validation, datasets, "dry-run");
    const fingerprint = fingerprintImportPlan(plan);

    expect(plan.operations).toHaveLength(405);
    expect(plan.buildings).toHaveLength(8);
    expect(plan.units).toHaveLength(198);
    expect(plan.priceHistoryRows).toHaveLength(198);
    expect(plan.units.every((unit) => unit.sourceFile === CORALINA_SOURCE_FILENAME)).toBe(true);
    expect(
      plan.priceHistoryRows.every((row) => row.sourceFile === CORALINA_SOURCE_FILENAME),
    ).toBe(true);
    expect(plan.units.every((unit) => isSafeSourceFileName(unit.sourceFile!))).toBe(true);
    expect(plan.priceHistoryRows.every((row) => isSafeSourceFileName(row.sourceFile!))).toBe(true);

    const unitInventory = datasets.priceList?.unit_inventory;
    expect(unitInventory).toBeDefined();
    if (!unitInventory) {
      throw new Error("Coralina price-list fixture must include unit_inventory");
    }
    const firstPriceFact = unitInventory[0]?.price;
    expect(firstPriceFact?.source_file).toBe(CORALINA_SOURCE_PATH);
    expect(
      plan.buildings.every((building) =>
        (building.metadata?.source_files as string[]).includes(CORALINA_SOURCE_PATH),
      ),
    ).toBe(true);

    const request = buildServerExecutionRequest({
      manifest,
      operations: plan.operations,
      operationCounts: fingerprint.operationCounts,
      planHash: fingerprint.hash,
      target: "production",
      targetProjectId: "abtvsrcnfwlbawvrjeed",
      approvalDigest: "a".repeat(64),
      collisionReportFingerprint: "b".repeat(64),
    });
    expect(request.ok).toBe(true);
    if (!request.ok) return;

    const sourceFiles = request.request.entities.priceHistory.map((row) => row.source_file);
    expect(sourceFiles).toHaveLength(198);
    expect(sourceFiles.every((sourceFile) => sourceFile === CORALINA_SOURCE_FILENAME)).toBe(true);
    expect(sourceFiles.every((sourceFile) => sourceFile && isSafeSourceFileName(sourceFile))).toBe(
      true,
    );
  });
});
