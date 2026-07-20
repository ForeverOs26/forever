import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExtractedPriceList } from "@/import/types";

import {
  BOUND_PRICE_ARTIFACT_KEYS,
  buildVersionDiff,
  writeSIP001BPackage,
  type BoundPriceArtifactPaths,
} from "../update-package";
import { parseSipPackageArgs } from "../package-cli-args";

const fact = <T extends string | number>(value: T, page = 1) => ({
  value,
  source_file: "price-list.pdf",
  page_number: page,
  confidence: "high" as const,
  status: "source_verified" as const,
});

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("SIP-001B version diff", () => {
  it("uses missing_from_latest_price_list without fabricating an availability outcome", () => {
    const previous = {
      price_list_date: fact("2026-07-03"),
      unit_inventory: [
        { source_row: 1, unit_number: fact("A101"), price: fact(100), price_per_sqm: fact(10) },
        { source_row: 2, unit_number: fact("A102"), price: fact(200), price_per_sqm: fact(20) },
      ],
    };
    const latest = {
      price_list_date: fact("2026-07-17"),
      unit_inventory: [
        { source_row: 1, unit_number: fact("A101"), price: fact(120), price_per_sqm: fact(12) },
        { source_row: 2, unit_number: fact("A103"), price: fact(300), price_per_sqm: fact(30) },
      ],
    };
    const diff = buildVersionDiff(previous, latest);
    expect(diff.units_absent_from_new_available_table).toEqual([
      expect.objectContaining({
        unit_identity: "A102",
        classification: "missing_from_latest_price_list",
      }),
    ]);
    expect(diff.price_changes).toEqual([
      expect.objectContaining({ unit_identity: "A101", absolute_delta: 20, percentage_delta: 20 }),
    ]);
    expect(diff.summary_counts).toMatchObject({ added: 1, missing_from_latest_price_list: 1 });
  });
});

describe("SIP-001B generic package integrity", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sip-package-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function writeJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  function makeInput(overrides: Partial<{ updateDate: string; originChannel: string }> = {}) {
    const priceDir = join(dir, "sources", "price");
    const masterDir = join(dir, "sources", "master");
    const artifactDir = join(dir, "artifacts");
    const pricePdfPath = join(priceDir, "synthetic-price-list.pdf");
    const masterPdfPath = join(masterDir, "synthetic-master-plan.pdf");
    const sourceProofPath = join(artifactDir, "source-proof.json");
    const qualificationPath = join(artifactDir, "qualification.json");
    const candidatePath = join(artifactDir, "candidate-price-list.json");
    const reviewPath = join(artifactDir, "review-summary.json");
    const summaryPath = join(artifactDir, "preparation-summary.json");
    const reviewedPath = join(artifactDir, "reviewed-price-list.json");
    const updateDate = overrides.updateDate ?? "2031-04-05";
    const generationId = "synthetic-generation";
    mkdirSync(priceDir, { recursive: true });
    mkdirSync(masterDir, { recursive: true });
    writeFileSync(pricePdfPath, "synthetic price source", "utf8");
    writeFileSync(masterPdfPath, "synthetic master source", "utf8");
    const fingerprint = { sha256: sha256File(pricePdfPath), byte_size: 22 };
    const reviewed: ExtractedPriceList = {
      price_list_date: fact(updateDate),
      unit_inventory: [{ source_row: 1, unit_number: fact("S101"), price: fact(123456) }],
    };
    writeJson(sourceProofPath, {
      sip_schema_version: "1",
      project_slug: "synthetic-project",
      source_filename: "synthetic-price-list.pdf",
      ...fingerprint,
      generation_id: generationId,
      pre_processing: fingerprint,
      post_processing: fingerprint,
      hash_verified_unchanged_after_extraction: true,
    });
    writeJson(qualificationPath, {
      status: "QUALIFIED_SUPPORTED_LAYOUT",
      source_pdf_sha256: fingerprint.sha256,
    });
    writeJson(candidatePath, reviewed);
    writeJson(reviewPath, {
      project_slug: "synthetic-project",
      source_pdf_sha256: fingerprint.sha256,
      generation_id: generationId,
      items: [],
    });
    writeJson(reviewedPath, reviewed);
    writeJson(summaryPath, {
      project_slug: "synthetic-project",
      source_pdf_sha256: fingerprint.sha256,
      generation_id: generationId,
      artifact_hashes: {
        source_proof: sha256File(sourceProofPath),
        qualification: sha256File(qualificationPath),
        candidate_price_list: sha256File(candidatePath),
        review_summary: sha256File(reviewPath),
        reviewed_price_list: sha256File(reviewedPath),
      },
    });
    const priceArtifacts: BoundPriceArtifactPaths = {
      source_proof: sourceProofPath,
      qualification: qualificationPath,
      candidate_price_list: candidatePath,
      review_summary: reviewPath,
      preparation_summary: summaryPath,
      reviewed_price_list: reviewedPath,
    };
    return {
      projectSlug: "synthetic-project",
      updateDate,
      originChannel: overrides.originChannel ?? "@synthetic_channel",
      pricePdfPath,
      masterPdfPath,
      priceArtifacts,
      previousPriceList: { price_list_date: fact("2031-04-01"), unit_inventory: [] },
      outDir: join(dir, "out"),
      workspaceRoot: join(dir, "workspace"),
      toolOverride: {
        found: true,
        executablePath: "test-only",
        vendor: "unknown" as const,
        versionOutput: "test",
        version: "1.0.0",
        pdfinfoAvailable: false,
        pdfinfoVersion: null,
        executableSha256: null,
        error: null,
      },
      masterExtractionOverride: () => ({
        mode: "layout" as const,
        toolVersion: "1.0.0",
        exitCode: 0,
        pages: [],
        pageCount: 3,
        outputSha256: "a".repeat(64),
        outputByteLength: 0,
        stderrExcerpt: null,
        timedOut: false,
      }),
    };
  }

  it("accepts a synthetic project/date/channel and binds every finalized price artifact", () => {
    const result = writeSIP001BPackage(makeInput());
    expect(result.sourceBundle).toMatchObject({
      project_slug: "synthetic-project",
      update_date: "2031-04-05",
      origin_channel: "@synthetic_channel",
    });
    expect(Object.keys(result.sourceBundle.price_artifact_hashes)).toEqual(
      BOUND_PRICE_ARTIFACT_KEYS,
    );
    expect(result.masterSourceProof.pre_processing).toEqual(
      result.masterSourceProof.post_processing,
    );
    expect(result.masterRegistration).not.toHaveProperty("visible_floor_page_sequence");
    expect(result.masterRegistration.floor_sequence_status).toBe(
      "not_machine_interpreted_in_sip_001b",
    );
  });

  it("is deterministic and changes bundle identity when a bound artifact changes", () => {
    const firstInput = makeInput();
    const first = writeSIP001BPackage(firstInput);
    const firstBundle = readFileSync(join(firstInput.outDir, "source-bundle.json"), "utf8");
    const secondInput = { ...firstInput, outDir: join(dir, "out-second") };
    const second = writeSIP001BPackage(secondInput);
    expect(readFileSync(join(secondInput.outDir, "source-bundle.json"), "utf8")).toBe(firstBundle);

    writeJson(firstInput.priceArtifacts.review_summary, { items: ["tampered"] });
    expect(() => writeSIP001BPackage({ ...firstInput, outDir: join(dir, "out-tampered") })).toThrow(
      /sip_package_artifact_hash_mismatch: review_summary/,
    );
    expect(first.sourceBundle.bundle_id).toBe(second.sourceBundle.bundle_id);
  });

  it("rejects an update date that does not match the finalized price-list content", () => {
    expect(() => writeSIP001BPackage(makeInput({ updateDate: "2031-04-06" }))).not.toThrow();
    const input = makeInput();
    expect(() =>
      writeSIP001BPackage({
        ...input,
        updateDate: "2031-04-06",
        outDir: join(dir, "out-mismatch"),
      }),
    ).toThrow(/sip_package_update_date_price_list_mismatch/);
  });

  it("rejects an invalid optional Telegram public-channel reference", () => {
    expect(() =>
      writeSIP001BPackage(makeInput({ originChannel: "channel without at sign" })),
    ).toThrow(/sip_package_origin_channel_invalid/);
  });

  it("keeps project, date, and channel data out of reusable package modules", () => {
    for (const file of ["update-package.ts", "package-cli.ts", "package-cli-args.ts"]) {
      const source = readFileSync(join(__dirname, "..", file), "utf8");
      expect(source).not.toMatch(/coralina|2026-07-17|@coralinakamala/i);
    }
  });

  it("rejects duplicate generic CLI inputs rather than silently overwriting one", () => {
    expect(() =>
      parseSipPackageArgs(["--project-slug", "synthetic-one", "--project-slug", "synthetic-two"]),
    ).toThrow("sip_package_duplicate_argument: --project-slug");
  });

  it("rejects malformed, missing, or duplicate bound artifact references", () => {
    const malformed = makeInput();
    writeJson(malformed.priceArtifacts.preparation_summary, { artifact_hashes: {} });
    expect(() => writeSIP001BPackage(malformed)).toThrow(
      /sip_package_preparation_hash_keys_invalid/,
    );

    const duplicate = makeInput();
    duplicate.priceArtifacts.qualification = duplicate.priceArtifacts.source_proof;
    expect(() => writeSIP001BPackage(duplicate)).toThrow(/sip_package_duplicate_artifact_path/);
  });

  it("rejects a package whose artifacts do not belong to its requested project or generation", () => {
    const projectMismatch = makeInput();
    expect(() => writeSIP001BPackage({ ...projectMismatch, projectSlug: "other-project" })).toThrow(
      /sip_package_price_source_proof_mismatch/,
    );

    const generationMismatch = makeInput();
    const sourceProof = JSON.parse(
      readFileSync(generationMismatch.priceArtifacts.source_proof, "utf8"),
    ) as Record<string, unknown>;
    writeJson(generationMismatch.priceArtifacts.source_proof, {
      ...sourceProof,
      generation_id: "other-generation",
    });
    const summary = JSON.parse(
      readFileSync(generationMismatch.priceArtifacts.preparation_summary, "utf8"),
    ) as { artifact_hashes: Record<string, string> };
    writeJson(generationMismatch.priceArtifacts.preparation_summary, {
      ...summary,
      artifact_hashes: {
        ...summary.artifact_hashes,
        source_proof: sha256File(generationMismatch.priceArtifacts.source_proof),
      },
    });
    expect(() => writeSIP001BPackage(generationMismatch)).toThrow(
      /sip_package_review_summary_generation_mismatch/,
    );
  });

  it("rejects a bound artifact path that package output would overwrite", () => {
    const input = makeInput();
    input.priceArtifacts.source_proof = join(input.outDir, "source-bundle.json");
    writeJson(input.priceArtifacts.source_proof, {
      sip_schema_version: "1",
      project_slug: "synthetic-project",
      source_filename: "synthetic-price-list.pdf",
      sha256: sha256File(input.pricePdfPath),
      byte_size: 22,
      pre_processing: { sha256: sha256File(input.pricePdfPath), byte_size: 22 },
      post_processing: { sha256: sha256File(input.pricePdfPath), byte_size: 22 },
      hash_verified_unchanged_after_extraction: true,
      generation_id: "synthetic-generation",
    });
    const summary = JSON.parse(readFileSync(input.priceArtifacts.preparation_summary, "utf8")) as {
      artifact_hashes: Record<string, string>;
    };
    writeJson(input.priceArtifacts.preparation_summary, {
      ...summary,
      artifact_hashes: {
        ...summary.artifact_hashes,
        source_proof: sha256File(input.priceArtifacts.source_proof),
      },
    });
    expect(() => writeSIP001BPackage(input)).toThrow(/sip_package_artifact_output_path_collision/);
  });
});
