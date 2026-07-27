/**
 * Package Factory — the PDF text layer.
 *
 * Thin wrapper over the existing SIP `pdftotext` boundary
 * (`src/intake/sip/pdf-tool.ts`): same preflight, same argument-array
 * invocation, same bounded execution and output. The Factory only adds
 * "extract from bytes I already hold" and a cached preflight, because the
 * resolver holds artifacts in memory rather than as Owner-supplied paths.
 *
 * `-table` is Xpdf's table-preserving mode and is what makes a price schedule
 * parseable at all; `-layout` is the Poppler-compatible fallback. When neither
 * the tool nor a text layer exists, extraction returns null and the Factory
 * reports a missing current price rather than inventing one.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { preflightPdftotext, runPdftotextLayout } from "../../intake/sip/pdf-tool";
import type { PdfToolPreflight } from "../../intake/sip/types";

export interface PdfText {
  /** Full text, pages joined with form feeds preserved as newlines. */
  text: string;
  pageCount: number;
  mode: "layout" | "table";
  toolVersion: string | null;
}

let cachedPreflight: PdfToolPreflight | null = null;

/** Preflight once per process; the probe spawns a subprocess. */
export function pdfTool(): PdfToolPreflight {
  cachedPreflight ??= preflightPdftotext();
  return cachedPreflight;
}

/** Test seam: install a preflight result without probing the host. */
export function setPdfToolForTesting(tool: PdfToolPreflight | null): void {
  cachedPreflight = tool;
}

/**
 * Extract the text layer of a PDF held in memory.
 *
 * Returns null (never throws) when the tool is unavailable, the document has no
 * text layer, or extraction fails — all of which are ordinary conditions that
 * must degrade to "no price source", not to a crashed run.
 */
export function extractPdfText(
  bytes: Buffer,
  preferredMode: "table" | "layout" = "table",
): PdfText | null {
  const tool = pdfTool();
  if (!tool.found || !tool.executablePath) return null;

  const workspace = mkdtempSync(join(tmpdir(), "forever-factory-pdf-"));
  const pdfPath = join(workspace, "source.pdf");
  try {
    writeFileSync(pdfPath, bytes);
    const modes: Array<"table" | "layout"> =
      preferredMode === "table" && tool.vendor === "xpdf" ? ["table", "layout"] : ["layout"];
    for (const mode of modes) {
      try {
        const extraction = runPdftotextLayout({ tool, pdfPath, workspaceDir: workspace, mode });
        const text = extraction.pages.map((page) => page.text).join("\f\n");
        if (text.replace(/\s/g, "").length === 0) continue;
        return {
          text,
          pageCount: extraction.pageCount,
          mode: extraction.mode,
          toolVersion: extraction.toolVersion,
        };
      } catch {
        // Try the next mode; a tool failure is not a Factory failure.
      }
    }
    return null;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
