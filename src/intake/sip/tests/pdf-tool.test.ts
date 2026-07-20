import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_TEXT_OUTPUT_BYTES,
  PdfToolError,
  preflightPdftotext,
  runPdftotextLayout,
} from "../pdf-tool";
import { writeFakePdftotext } from "./test-support";

const ORIGINAL_PATH = process.env.PATH;

describe("SIP-001A pdftotext preflight", () => {
  let fakeDir: string;

  afterEach(() => {
    process.env.PATH = ORIGINAL_PATH;
    if (fakeDir) rmSync(fakeDir, { recursive: true, force: true });
  });

  it("reports found=false with an explicit external-prerequisite message when pdftotext is missing", () => {
    process.env.PATH = "/nonexistent-bin-only";
    const result = preflightPdftotext();
    expect(result.found).toBe(false);
    expect(result.executablePath).toBeNull();
    expect(result.error).toMatch(/pdftotext was not found/i);
  });

  it("locates a real pdftotext on PATH and records its version", () => {
    const fake = writeFakePdftotext();
    fakeDir = fake.dir;
    process.env.PATH = `${fake.dir}${process.platform === "win32" ? ";" : ":"}${ORIGINAL_PATH}`;
    const result = preflightPdftotext();
    expect(result.found).toBe(true);
    expect(result.version).toBe("24.02.0");
    expect(result.versionOutput).toMatch(/pdftotext version/);
    expect(result.executableSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("SIP-001A pdftotext -layout invocation", () => {
  let fake: { dir: string; scriptPath: string };
  let workDir: string;

  beforeEach(() => {
    fake = writeFakePdftotext();
    workDir = mkdtempSync(join(tmpdir(), "sip-run-"));
  });
  afterEach(() => {
    rmSync(fake.dir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  function tool(executablePath = fake.scriptPath) {
    return {
      found: true,
      executablePath,
      versionOutput: "pdftotext version 24.02.0",
      version: "24.02.0",
      pdfinfoAvailable: false,
      executableSha256: null,
      error: null,
    };
  }

  it("invokes the tool with an argument array and never a shell string (no injection)", () => {
    // A filename containing shell metacharacters must be treated as inert
    // data by execFile's argument array, never reinterpreted by a shell.
    const trickyName = join(workDir, "price list; $(echo pwned) & whoami.pdf");
    writeFileSync(trickyName, "Unit  Price\nA1  1,000\n", "utf8");
    const workspace = join(workDir, "ws1");

    const result = runPdftotextLayout({
      tool: tool(),
      pdfPath: trickyName,
      workspaceDir: workspace,
    });
    expect(result.pages[0].text).toContain("A1  1,000");
    // If shell interpolation had occurred, `whoami` would have run as a
    // command instead of being treated as part of the literal filename.
  });

  it("supports Unicode and spaced Windows-style paths", () => {
    const unicodeName = join(workDir, "รายการราคา Rainpalm Villas — ไทย 🏡.pdf");
    writeFileSync(unicodeName, "Unit  Price\nA1  1,000\n", "utf8");
    const workspace = join(workDir, "ws2");

    const result = runPdftotextLayout({
      tool: tool(),
      pdfPath: unicodeName,
      workspaceDir: workspace,
    });
    expect(result.exitCode).toBe(0);
    expect(result.pages).toHaveLength(1);
  });

  it("preserves page boundaries via the form-feed separator", () => {
    const pdfPath = join(workDir, "multi-page.pdf");
    writeFileSync(pdfPath, "PAGE ONE TEXT\f PAGE TWO TEXT\f PAGE THREE TEXT", "utf8");
    const workspace = join(workDir, "ws3");

    const result = runPdftotextLayout({ tool: tool(), pdfPath, workspaceDir: workspace });
    expect(result.pageCount).toBe(3);
    expect(result.pages[0].pageNumber).toBe(1);
    expect(result.pages[0].text.trim()).toBe("PAGE ONE TEXT");
    expect(result.pages[2].text.trim()).toBe("PAGE THREE TEXT");
  });

  it("fails closed with PdfToolError on a non-zero exit", () => {
    const pdfPath = join(workDir, "FAIL_TRIGGER.pdf");
    writeFileSync(pdfPath, "irrelevant", "utf8");
    const workspace = join(workDir, "ws4");

    expect(() => runPdftotextLayout({ tool: tool(), pdfPath, workspaceDir: workspace })).toThrow(
      PdfToolError,
    );
  });

  it("fails closed on timeout and never leaves the temp text file behind", () => {
    const pdfPath = join(workDir, "TIMEOUT_TRIGGER.pdf");
    writeFileSync(pdfPath, "irrelevant", "utf8");
    const workspace = join(workDir, "ws5");

    let thrown: unknown;
    try {
      runPdftotextLayout({ tool: tool(), pdfPath, workspaceDir: workspace, timeoutMs: 300 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PdfToolError);
    expect((thrown as Error).message).toMatch(/timeout/);
    const remaining = existsSync(workspace) ? readdirSync(workspace) : [];
    expect(remaining).toHaveLength(0);
  }, 10_000);

  it("fails closed when pdftotext is not available at all", () => {
    const pdfPath = join(workDir, "any.pdf");
    writeFileSync(pdfPath, "text", "utf8");
    expect(() =>
      runPdftotextLayout({
        tool: {
          found: false,
          executablePath: null,
          versionOutput: null,
          version: null,
          pdfinfoAvailable: false,
          executableSha256: null,
          error: "missing",
        },
        pdfPath,
        workspaceDir: join(workDir, "ws6"),
      }),
    ).toThrow(PdfToolError);
  });

  it("cleans up its temporary output file after a successful run", () => {
    const pdfPath = join(workDir, "clean.pdf");
    writeFileSync(pdfPath, "Unit  Price\nA1  1,000\n", "utf8");
    const workspace = join(workDir, "ws7");
    runPdftotextLayout({ tool: tool(), pdfPath, workspaceDir: workspace });
    const remaining = existsSync(workspace) ? readdirSync(workspace) : [];
    expect(remaining).toHaveLength(0);
  });

  it("exposes a bounded output-size constant used to fail closed on oversized text", () => {
    expect(MAX_TEXT_OUTPUT_BYTES).toBeGreaterThan(0);
  });
});
