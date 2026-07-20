/**
 * Proves the unchanged, existing Fast Intake v1 (`../../run`) consumes a
 * SIP-001A reviewed `ExtractedPriceList` exactly like any other structured
 * price-list artifact — no second payload builder, no second Fast Intake
 * CLI, and no change to Fast Intake itself.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runIntake } from "../../run";
import { runSipPriceListExtraction } from "../run";
import { readFixture, writeFakePdftotext } from "./test-support";

const ORIGINAL_PATH = process.env.PATH;

describe("SIP-001A finalized output — unchanged Fast Intake consumption", () => {
  let fake: { dir: string; scriptPath: string };
  let base: string;

  beforeEach(() => {
    fake = writeFakePdftotext();
    process.env.PATH = `${fake.dir}:${ORIGINAL_PATH}`;
    base = mkdtempSync(join(tmpdir(), "sip-fastintake-"));
  });
  afterEach(() => {
    process.env.PATH = ORIGINAL_PATH;
    rmSync(fake.dir, { recursive: true, force: true });
    rmSync(base, { recursive: true, force: true });
  });

  it("validates a draft-ready payload from a SIP-reviewed price list, unmodified", async () => {
    const sourceDir = join(base, "source-pdf");
    mkdirSync(sourceDir, { recursive: true });
    const pdfPath = join(sourceDir, "rainpalm-villas-price-list.pdf");
    writeFileSync(pdfPath, readFixture("generic-price-list.pdftotext-layout.txt"), "utf8");

    const sipResult = runSipPriceListExtraction({
      projectSlug: "rainpalm-villas",
      pdfPath,
      outRoot: join(base, "sip-out"),
      workspaceRoot: join(base, "sip-ws"),
      toolOverride: {
        found: true,
        executablePath: process.execPath,
        argumentPrefix: [fake.scriptPath],
        vendor: "unknown",
        versionOutput: "pdftotext version 24.02.0",
        version: "24.02.0",
        pdfinfoAvailable: false,
        pdfinfoVersion: null,
        executableSha256: null,
        error: null,
      },
    });
    expect(sipResult.preparationSummary.finalized).toBe(true);

    // Feed the finalized output into Fast Intake exactly as any other
    // pre-prepared structured price-list artifact — copied verbatim, not
    // rebuilt by a second payload builder.
    const intakeSourceDir = join(base, "intake-source", "price-list");
    mkdirSync(intakeSourceDir, { recursive: true });
    writeFileSync(
      join(intakeSourceDir, "price-list.json"),
      JSON.stringify(sipResult.reviewedPriceList),
      "utf8",
    );

    const intakeResult = await runIntake({
      projectSlug: "rainpalm-villas",
      projectName: "Rainpalm Villas",
      sources: [intakeSourceDir],
      outRoot: join(base, "intake-out"),
      workspaceRoot: join(base, "intake-ws"),
    });

    expect(intakeResult.summary.validation.ok).toBe(true);
    expect(intakeResult.summary.validation.error).toBeNull();
    expect(intakeResult.status).not.toBe("BLOCKED");
    expect(intakeResult.summary.planned_graph_counts.units).toBeGreaterThan(0);
    expect(intakeResult.summary.planned_graph_counts.prices).toBeGreaterThan(0);
  });
});
