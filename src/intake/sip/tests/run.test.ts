import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runSipPriceListExtraction } from "../run";
import { readFixture, writeFakePdftotext } from "./test-support";

const ORIGINAL_PATH = process.env.PATH;

describe("SIP-001A run orchestrator — end to end (fake local Poppler)", () => {
  let fake: { dir: string; scriptPath: string };
  let base: string;

  beforeEach(() => {
    fake = writeFakePdftotext();
    process.env.PATH = `${fake.dir}:${ORIGINAL_PATH}`;
    base = mkdtempSync(join(tmpdir(), "sip-run-e2e-"));
  });
  afterEach(() => {
    process.env.PATH = ORIGINAL_PATH;
    rmSync(fake.dir, { recursive: true, force: true });
    rmSync(base, { recursive: true, force: true });
  });

  function writePdfLike(name: string, fixtureName: string): string {
    const path = join(base, name);
    writeFileSync(path, readFixture(fixtureName), "utf8");
    return path;
  }

  it("qualifies, extracts, and finalizes the supported Rainpalm-like fixture", () => {
    const pdfPath = writePdfLike(
      "rainpalm-villas-price-list.pdf",
      "rainpalm-price-list.pdftotext-layout.txt",
    );
    const result = runSipPriceListExtraction({
      projectSlug: "rainpalm-villas",
      pdfPath,
      outRoot: join(base, "out"),
      workspaceRoot: join(base, "ws"),
    });

    expect(result.qualification.status).toBe("QUALIFIED_SUPPORTED_LAYOUT");
    expect(result.preparationSummary.finalized).toBe(true);
    expect(result.reviewedPriceList).not.toBeNull();
    expect(result.preparationSummary.blocking_issues).toEqual([]);
    expect(result.sourceProof.source_filename).toBe("rainpalm-villas-price-list.pdf");
    // Portable source reference only — never the Owner-machine absolute path
    // inside the candidate/reviewed row facts themselves.
    expect(result.candidatePriceList.unit_inventory?.[0]?.price?.source_file).toBe(
      "rainpalm-villas-price-list.pdf",
    );

    for (const path of Object.values(result.paths)) {
      expect(readFileSync(path, "utf8")).toBeTruthy();
    }
  });

  it("never writes reviewed-price-list.json when the pdftotext tool is unavailable", () => {
    process.env.PATH = "/nonexistent-bin-only";
    const pdfPath = writePdfLike("no-tool.pdf", "rainpalm-price-list.pdftotext-layout.txt");
    const result = runSipPriceListExtraction({
      projectSlug: "rainpalm-villas",
      pdfPath,
      outRoot: join(base, "out2"),
      workspaceRoot: join(base, "ws2"),
    });

    expect(result.qualification.status).toBe("TOOL_FAILURE");
    expect(result.preparationSummary.finalized).toBe(false);
    expect(result.preparationSummary.blocking_issues[0]).toMatch(
      /BLOCKED — AUTHORIZED PDF TEXT TOOL REQUIRED/,
    );
    expect(result.reviewedPriceList).toBeNull();
  });

  it("does not finalize when a blocking duplicate unit identity is present", () => {
    const pdfPath = writePdfLike("dup.pdf", "duplicate-identity.pdftotext-layout.txt");
    const result = runSipPriceListExtraction({
      projectSlug: "rainpalm-villas",
      pdfPath,
      outRoot: join(base, "out3"),
      workspaceRoot: join(base, "ws3"),
    });

    expect(result.preparationSummary.finalized).toBe(false);
    expect(result.reviewedPriceList).toBeNull();
    expect(result.preparationSummary.blocking_issues.some((i) => i.includes("duplicate"))).toBe(
      true,
    );
    // Candidate output and review summary are still produced (partial success).
    expect(result.candidatePriceList.unit_inventory?.length).toBeGreaterThan(0);
  });

  it("produces a byte-identical deterministic repeat run", () => {
    const pdfPath = writePdfLike("det.pdf", "rainpalm-price-list.pdftotext-layout.txt");
    const runOnce = () =>
      runSipPriceListExtraction({
        projectSlug: "rainpalm-villas",
        pdfPath,
        outRoot: join(base, `out-${Math.random()}`),
        workspaceRoot: join(base, `ws-${Math.random()}`),
      });

    const a = runOnce();
    const b = runOnce();

    expect(readFileSync(a.paths.candidate_price_list, "utf8")).toBe(
      readFileSync(b.paths.candidate_price_list, "utf8"),
    );
    expect(readFileSync(a.paths.review_summary, "utf8")).toBe(
      readFileSync(b.paths.review_summary, "utf8"),
    );
    expect(readFileSync(a.paths.reviewed_price_list, "utf8")).toBe(
      readFileSync(b.paths.reviewed_price_list, "utf8"),
    );
    expect(readFileSync(a.paths.qualification, "utf8")).toBe(
      readFileSync(b.paths.qualification, "utf8"),
    );
    // source-proof's sha256/byte_size are deterministic; only local_only_path
    // (explicitly operational) is expected to differ between the two temp dirs.
    const sourceProofA = JSON.parse(readFileSync(a.paths.source_proof, "utf8"));
    const sourceProofB = JSON.parse(readFileSync(b.paths.source_proof, "utf8"));
    expect(sourceProofA.sha256).toBe(sourceProofB.sha256);
    expect(sourceProofA.byte_size).toBe(sourceProofB.byte_size);
  });

  it("leaves no lock, staging, or temporary residue in the workspace after a run", () => {
    const pdfPath = writePdfLike("clean.pdf", "rainpalm-price-list.pdftotext-layout.txt");
    const workspaceRoot = join(base, "ws-clean");
    runSipPriceListExtraction({
      projectSlug: "rainpalm-villas",
      pdfPath,
      outRoot: join(base, "out-clean"),
      workspaceRoot,
    });
    const remaining = existsSync(workspaceRoot) ? readdirSync(workspaceRoot) : [];
    expect(remaining).toHaveLength(0);
  });
});

describe("SIP-001A — never reads the ground-truth comparison JSON during extraction", () => {
  it("run.ts never imports the compare module or calls its functions", () => {
    const runSource = readFileSync(join(__dirname, "..", "run.ts"), "utf8");
    expect(runSource).not.toMatch(/from ["']\.\/compare["']/);
    expect(runSource).not.toMatch(/compareAgainstGroundTruth|readExtractedPriceListFile/);
  });

  it("the extraction dependency modules never import the compare module", () => {
    for (const module of [
      "candidate-normalize.ts",
      "price-table.ts",
      "pdf-qualify.ts",
      "pdf-tool.ts",
      "review.ts",
      "artifacts.ts",
    ]) {
      const source = readFileSync(join(__dirname, "..", module), "utf8");
      expect(source).not.toMatch(/from ["']\.\/compare["']/);
    }
  });

  it("RunSipOptions carries no ground-truth field", () => {
    const source = readFileSync(join(__dirname, "..", "run.ts"), "utf8");
    const interfaceMatch = source.match(/export interface RunSipOptions \{[^}]*\}/);
    expect(interfaceMatch).not.toBeNull();
    expect(interfaceMatch![0]).not.toMatch(/ground/i);
  });

  it("only compare.ts / compare-cli.ts read an externally supplied comparison file", () => {
    const dir = join(__dirname, "..");
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.includes("test") && !f.startsWith("compare"),
    );
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source).not.toMatch(/readExtractedPriceListFile/);
    }
  });
});

describe("SIP-001A — no database client, network, import, or publication boundary", () => {
  it("no sip module imports a Supabase client, raw network module, or the Progressive/PowerShell importer", () => {
    const dir = join(__dirname, "..");
    const files = readdirSync(dir).filter((f: string) => f.endsWith(".ts") && !f.includes("test"));
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source).not.toMatch(/from ["'][^"']*supabase[^"']*["']/i);
      expect(source).not.toMatch(/from ["']node:https?["']/);
      expect(source).not.toMatch(/Import-ForeverProjectDraft/);
    }
  });
});
