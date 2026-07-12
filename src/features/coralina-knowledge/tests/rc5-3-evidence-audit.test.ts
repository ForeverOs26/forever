/**
 * RC5.3 evidence audit regression — pins the Coralina "developer" and
 * "country" blockers to the actual committed repository state so a future
 * change either resolves them with real evidence or this suite fails loudly.
 *
 * These tests read the real files on disk (not fixtures) so the audit
 * documented in `docs/CORALINA_RC5_3_EVIDENCE_AUDIT.md` stays honest: nothing
 * here asserts a fact, it asserts the absence of one, and asserts that
 * absence is honestly reflected by the definition and the readiness report.
 *
 * `forever-data/projects/coralina/source/*\/*` is deliberately excluded by
 * `.gitignore` (every entry except `.gitkeep`), so a machine running the
 * classification/extraction workflow can legitimately have real, large
 * source documents sitting on local disk without any of them ever being
 * committed. The "no committed source document" check below therefore reads
 * `git ls-files` — the actual committed/tracked state — rather than the raw
 * filesystem, so it stays true across every clone regardless of what a given
 * working copy happens to hold locally.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findProjectField } from "@/features/forever-project-database";
import { listCrossValidationFindingsByKind } from "@/features/forever-cross-validation";
import { listReadinessBlockers } from "@/features/forever-project-readiness";

import { CORALINA_KNOWLEDGE_DEFINITION } from "../definition";
import { CORALINA_EXTRACTION_FACTS } from "../facts";
import { describeCoralinaKnowledgeInspection } from "../inspection";
import { buildCoralinaKnowledgeSlice } from "../slice";

const CORALINA_DATA_ROOT = join(process.cwd(), "forever-data", "projects", "coralina");

const SOURCE_ASSET_FOLDERS = [
  "brochure",
  "price-list",
  "masterplan",
  "unit-plans",
  "documents",
  "images",
  "videos",
];

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(CORALINA_DATA_ROOT, relativePath), "utf8"));
}

/** Files git actually tracks under a path — unaffected by gitignored local disk contents. */
function gitTrackedFileNames(relativePath: string): string[] {
  const output = execFileSync("git", ["ls-files", "--", relativePath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("/").pop()!);
}

describe("RC5.3 Coralina evidence audit — grounded in committed repository state", () => {
  it("still has no git-committed binary source document for developer or country evidence", () => {
    for (const folder of SOURCE_ASSET_FOLDERS) {
      const tracked = gitTrackedFileNames(`forever-data/projects/coralina/source/${folder}`);
      expect(tracked, `${folder} unexpectedly has a git-tracked (committed) file`).toEqual([
        ".gitkeep",
      ]);
    }
  });

  it("still records both manifest identity fields as SOURCE_PENDING", () => {
    const manifest = readJson("manifest.json") as {
      developer: string;
      country: string;
      metadata_evidence: {
        developer_review: { value: string };
        country_review: { value: string };
      };
    };
    expect(manifest.developer).toBe("SOURCE_PENDING");
    expect(manifest.country).toBe("SOURCE_PENDING");
    expect(manifest.metadata_evidence.developer_review.value).toBe("SOURCE_PENDING");
    expect(manifest.metadata_evidence.country_review.value).toBe("SOURCE_PENDING");
  });

  it("still lists developer and country as blocked in import-status.json", () => {
    const importStatus = readJson("import-status.json") as {
      ready_for_import: boolean;
      mandatory_metadata_review: { still_blocked: { field: string }[] };
    };
    expect(importStatus.ready_for_import).toBe(false);
    const stillBlockedFields = importStatus.mandatory_metadata_review.still_blocked.map(
      (entry) => entry.field,
    );
    expect(stillBlockedFields).toEqual(expect.arrayContaining(["developer", "country"]));
  });

  it("still records null developer and country values in the extracted brochure dataset", () => {
    const brochure = readJson("extracted/brochure.json") as {
      developer: { value: unknown };
      location: { country: { value: unknown } };
    };
    expect(brochure.developer.value).toBeNull();
    expect(brochure.location.country.value).toBeNull();
  });

  it("declares no fact for developer.name or location.country (nothing was fabricated)", () => {
    const statedPaths = new Set(CORALINA_EXTRACTION_FACTS.map((fact) => fact.fieldPath));
    expect(statedPaths.has("developer.name")).toBe(false);
    expect(statedPaths.has("location.country")).toBe(false);
  });

  it("keeps both blockers declared as manifest-blocking gaps with a stated acquisition requirement", () => {
    const developerGap = CORALINA_KNOWLEDGE_DEFINITION.gaps.find(
      (gap) => gap.path === "developer.name",
    );
    const countryGap = CORALINA_KNOWLEDGE_DEFINITION.gaps.find(
      (gap) => gap.path === "location.country",
    );
    expect(developerGap?.manifestBlocker).toBe(true);
    expect(countryGap?.manifestBlocker).toBe(true);
    expect(developerGap?.reason).toContain("Required to resolve:");
    expect(countryGap?.reason).toContain("Required to resolve:");
  });

  it("keeps readiness blocked on exactly the two unresolved manifest blockers", () => {
    const slice = buildCoralinaKnowledgeSlice();
    expect(slice.readiness.report.standing).toBe("blocked");
    const blockerPaths = listReadinessBlockers(slice.readiness.report)
      .map((evaluation) => evaluation.requirement.path)
      .sort();
    expect(blockerPaths).toEqual(["developer.name", "location.country"]);
  });

  it("never materialises a canonical field for developer.name or location.country", () => {
    const slice = buildCoralinaKnowledgeSlice();
    expect(findProjectField(slice.canonical.record, "developer.name")).toBeUndefined();
    expect(findProjectField(slice.canonical.record, "location.country")).toBeUndefined();
  });

  it("surfaces the extended acquisition requirement on the inspection route", () => {
    const inspection = describeCoralinaKnowledgeInspection(buildCoralinaKnowledgeSlice());
    const developerRow = inspection.missing.find((row) => row.path === "developer.name");
    const countryRow = inspection.missing.find((row) => row.path === "location.country");
    expect(developerRow?.reason).toContain("explicitly names Coralina's developer");
    expect(countryRow?.reason).toContain("explicitly states the country");
  });

  it("leaves the pre-existing unit-type dispute unresolved (not silently settled by this audit)", () => {
    const slice = buildCoralinaKnowledgeSlice();
    const conflicts = listCrossValidationFindingsByKind(slice.crossValidation.report, "conflict");
    const unitTypeConflict = conflicts.find((finding) => finding.path === "units.unitTypes");
    expect(unitTypeConflict?.disposition).toBe("requires_review");
    expect(
      findProjectField(slice.canonical.record, "units.unitTypes"),
      "unit-type dispute must not resolve into a single canonical field",
    ).toBeUndefined();
  });

  it("has committed no new Coralina source material since before the RC5.0 chain run", () => {
    // classification-log.json's own generated_at pins when the committed
    // source package was classified; RC5.3 added no later classification run.
    const classificationLog = readJson("classification-log.json") as { generated_at: string };
    expect(classificationLog.generated_at.startsWith("2026-07-08")).toBe(true);
  });
});
