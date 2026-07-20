/**
 * SIP-001A tests — shared fixture/support helpers. No production code depends
 * on this module.
 */
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PdfTextExtraction, PdfTextPage } from "../types";

export function fixturePath(name: string): string {
  return join(__dirname, "..", "test-fixtures", name);
}

export function readFixture(name: string): string {
  return readFileSync(fixturePath(name), "utf8");
}

/** Split raw pdftotext-layout-style text into pages exactly like pdf-tool.ts does. */
export function textToPages(rawText: string): PdfTextPage[] {
  const rawPages = rawText.split("\f");
  if (rawPages.length > 1 && rawPages[rawPages.length - 1].trim() === "") rawPages.pop();
  return rawPages.map((text, index) => ({
    pageNumber: index + 1,
    text,
    nonWhitespaceCharCount: text.replace(/\s/g, "").length,
  }));
}

export function fixtureExtraction(
  fixtureName: string,
  overrides: Partial<PdfTextExtraction> = {},
): PdfTextExtraction {
  const rawText = readFixture(fixtureName);
  const pages = textToPages(rawText);
  return {
    mode: "layout",
    toolVersion: "24.02.0",
    exitCode: 0,
    pages,
    pageCount: pages.length,
    outputSha256: "test-sha",
    outputByteLength: rawText.length,
    stderrExcerpt: null,
    timedOut: false,
    ...overrides,
  };
}

/**
 * Write a small fake `pdftotext` Node script into a fresh temp directory and
 * return its absolute path. Supports `-v` (prints a version string) and
 * `-layout -enc UTF-8 <pdf> <out>` (copies the PDF's own text content to the
 * output path — good enough to prove real argument-array spawning, Unicode
 * and spaced paths, and bounded execution without needing real Poppler).
 * A PDF path containing `TIMEOUT_TRIGGER` hangs; one containing
 * `FAIL_TRIGGER` exits non-zero.
 */
export function writeFakePdftotext(): { dir: string; scriptPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "sip-fake-poppler-"));
  const scriptPath = join(dir, "pdftotext");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "-v") {
  process.stderr.write("pdftotext version 24.02.0\\n");
  process.exit(0);
}
const pdfPath = args[args.length - 2];
const outPath = args[args.length - 1];
if (pdfPath.includes("TIMEOUT_TRIGGER")) {
  setTimeout(() => {}, 1e9);
} else if (pdfPath.includes("FAIL_TRIGGER")) {
  process.stderr.write("simulated pdftotext failure\\n");
  process.exit(1);
} else {
  const content = fs.readFileSync(pdfPath, "utf8");
  fs.writeFileSync(outPath, content);
  process.exit(0);
}
`;
  writeFileSync(scriptPath, script, { encoding: "utf8" });
  chmodSync(scriptPath, 0o755);
  return { dir, scriptPath };
}
