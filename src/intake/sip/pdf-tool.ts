/**
 * SIP-001A — local Poppler `pdftotext` preflight and invocation.
 *
 * Existing local Poppler ONLY. This module never installs, downloads, or
 * upgrades anything. Every process invocation uses an argument array
 * (`execFile`), never an interpolated shell string, so Windows Unicode paths
 * and spaces in the PDF path are passed through safely and no path can be
 * reinterpreted as a shell command.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import type { PdfTextExtraction, PdfTextPage, PdfToolPreflight } from "./types";

const VERSION_TIMEOUT_MS = 5_000;
const RESOLVE_TIMEOUT_MS = 5_000;

/** Bound on `pdftotext -layout` wall-clock execution. Fails closed past this. */
export const PDFTOTEXT_RUN_TIMEOUT_MS = 60_000;
/** Bound on the produced text-layer output. A larger result fails closed. */
export const MAX_TEXT_OUTPUT_BYTES = 50 * 1024 * 1024;

/** Repository-documented / previously used local Windows Poppler install paths. */
const WINDOWS_CANDIDATE_PATHS = [
  "C:\\poppler\\Library\\bin\\pdftotext.exe",
  "C:\\Program Files\\poppler\\Library\\bin\\pdftotext.exe",
  "C:\\Program Files\\poppler-24.02.0\\Library\\bin\\pdftotext.exe",
];

function parseVersion(output: string): string | null {
  const match = output.match(/version\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
  return match ? match[1] : null;
}

function tryVersion(executable: string): { output: string; version: string | null } | null {
  // `spawnSync` (unlike `execFileSync`) reliably returns BOTH stdout and
  // stderr regardless of exit status — Poppler's `-v` writes its version to
  // stderr, and some builds exit non-zero even on success.
  const result = spawnSync(executable, ["-v"], {
    timeout: VERSION_TIMEOUT_MS,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") return null;
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (combined.trim().length === 0) return null;
  return { output: combined, version: parseVersion(combined) };
}

/** Best-effort absolute-path resolution for a bare command, for hashing only. */
function resolveAbsolutePath(command: string): string | null {
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command) ? command : null;
  }
  const resolver = process.platform === "win32" ? "where.exe" : "which";
  try {
    const output = execFileSync(resolver, [command], {
      timeout: RESOLVE_TIMEOUT_MS,
      encoding: "utf8",
      windowsHide: true,
    });
    const first = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return first ?? null;
  } catch {
    return null;
  }
}

function hashExecutable(resolvedPath: string | null): string | null {
  if (!resolvedPath) return null;
  try {
    const stat = statSync(resolvedPath);
    if (!stat.isFile()) return null;
    return createHash("sha256").update(readFileSync(resolvedPath)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Locate a local `pdftotext`, in order: bare command on PATH (equivalent to
 * `where.exe`/`Get-Command`/POSIX PATH lookup), then repository-documented
 * Windows install paths. Installs nothing; never downloads.
 */
export function preflightPdftotext(): PdfToolPreflight {
  const candidates = [
    "pdftotext",
    ...(process.platform === "win32" ? WINDOWS_CANDIDATE_PATHS : []),
  ];

  for (const candidate of candidates) {
    const found = tryVersion(candidate);
    if (!found) continue;
    const resolvedPath = resolveAbsolutePath(candidate);
    return {
      found: true,
      executablePath: resolvedPath ?? candidate,
      versionOutput: found.output,
      version: found.version,
      pdfinfoAvailable: tryVersion("pdfinfo") !== null,
      executableSha256: hashExecutable(resolvedPath),
      error: null,
    };
  }

  return {
    found: false,
    executablePath: null,
    versionOutput: null,
    version: null,
    pdfinfoAvailable: tryVersion("pdfinfo") !== null,
    executableSha256: null,
    error:
      "pdftotext was not found on PATH or at any repository-documented local Poppler install path. " +
      "SIP-001A installs nothing; an authorized local Poppler executable is an external prerequisite.",
  };
}

export class PdfToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfToolError";
  }
}

function splitPages(rawText: string): PdfTextPage[] {
  // Poppler `pdftotext` separates pages with a form-feed (U+000C) unless
  // `-nopgbrk` is given; SIP-001A never passes `-nopgbrk` so page boundaries
  // stay traceable. A trailing form-feed produces one trailing empty page,
  // which is dropped.
  const rawPages = rawText.split("\f");
  if (rawPages.length > 1 && rawPages[rawPages.length - 1] === "") rawPages.pop();
  return rawPages.map((text, index) => ({
    pageNumber: index + 1,
    text,
    nonWhitespaceCharCount: text.replace(/\s/g, "").length,
  }));
}

export interface RunPdftotextInput {
  tool: PdfToolPreflight;
  pdfPath: string;
  /** Gitignored local workspace directory; never beside the raw PDF. */
  workspaceDir: string;
  /** Test-only override of the execution-time bound; defaults to the production constant. */
  timeoutMs?: number;
}

/**
 * Run `pdftotext -layout <pdf> <workspace-output>` with argument-array
 * invocation (never a shell string), bounded execution time, and a bounded
 * output size. Cleans up the temporary text file after both success and
 * failure. Fails closed (throws `PdfToolError`) on any process error,
 * timeout, or incomplete/oversized output.
 */
export function runPdftotextLayout(input: RunPdftotextInput): PdfTextExtraction {
  if (!input.tool.found || !input.tool.executablePath) {
    throw new PdfToolError("pdftotext_not_available");
  }
  mkdirSync(input.workspaceDir, { recursive: true });
  const outputPath = join(
    input.workspaceDir,
    `sip-pdftotext-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}.txt`,
  );
  let timedOut = false;
  let exitCode = 0;
  let stderrExcerpt: string | null = null;
  const timeoutMs = input.timeoutMs ?? PDFTOTEXT_RUN_TIMEOUT_MS;

  try {
    execFileSync(
      input.tool.executablePath,
      ["-layout", "-enc", "UTF-8", input.pdfPath, outputPath],
      { timeout: timeoutMs, windowsHide: true, encoding: "buffer" },
    );
  } catch (error) {
    const err = error as {
      killed?: boolean;
      signal?: string;
      status?: number | null;
      code?: string;
      stderr?: Buffer;
    };
    timedOut = err.code === "ETIMEDOUT" || Boolean(err.killed && err.signal === "SIGTERM");
    exitCode = typeof err.status === "number" ? err.status : 1;
    stderrExcerpt = err.stderr ? err.stderr.toString("utf8").slice(0, 2000) : null;
    cleanupOutput(outputPath);
    throw new PdfToolError(
      timedOut
        ? `pdftotext_timeout: exceeded ${timeoutMs}ms`
        : `pdftotext_process_error: exit=${exitCode}${stderrExcerpt ? ` stderr=${stderrExcerpt}` : ""}`,
    );
  }

  try {
    if (!existsSync(outputPath)) {
      throw new PdfToolError("pdftotext_no_output_produced");
    }
    const stat = statSync(outputPath);
    if (stat.size > MAX_TEXT_OUTPUT_BYTES) {
      throw new PdfToolError(`pdftotext_output_too_large: ${stat.size} > ${MAX_TEXT_OUTPUT_BYTES}`);
    }
    const rawBuffer = readFileSync(outputPath);
    const outputSha256 = createHash("sha256").update(rawBuffer).digest("hex");
    const rawText = rawBuffer.toString("utf8").replace(/^\uFEFF/, "");
    const pages = splitPages(rawText);

    return {
      toolVersion: input.tool.version,
      exitCode,
      pages,
      pageCount: pages.length,
      outputSha256,
      outputByteLength: rawBuffer.byteLength,
      stderrExcerpt,
      timedOut,
    };
  } finally {
    cleanupOutput(outputPath);
  }
}

function cleanupOutput(outputPath: string): void {
  try {
    rmSync(outputPath, { force: true });
  } catch {
    // Best-effort; the workspace directory itself is cleaned by the caller.
  }
}
