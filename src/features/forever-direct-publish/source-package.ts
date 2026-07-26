/**
 * Owner Direct Publish — source packages, read from anywhere
 * (FOREVER-STUDIO-OWNER-DIRECT-PUBLISH-001, Phase 4).
 *
 * A source package is just a folder the Owner already has: an extracted
 * developer archive, a Drive download, a Telegram export folder. It is read
 * directly from disk at publish time.
 *
 * Explicitly NOT required any more:
 *   - committing `forever-data/projects/<slug>` to Git;
 *   - editing `.gitignore` for a new project;
 *   - a branch, a pull request, or a merge to carry project JSON.
 *
 * Backward compatible: the existing `forever-data/projects/<slug>` layout
 * (`progressive/payload.json` + `source-manifest.json`) is still recognized, so
 * payloads already committed keep working unchanged.
 *
 * Server/CLI only — this module touches the filesystem and must never enter the
 * browser bundle.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

import type { ProgressiveBatch } from "@/features/forever-ingestion/batch-types";
import { assertProgressiveBatchStructure } from "@/features/forever-ingestion/batch-types";

import type { SourceMediaCandidate } from "./media-plan";

/** Payload locations checked in order. First match wins. */
export const PAYLOAD_CANDIDATE_PATHS: readonly string[] = [
  join("progressive", "payload.json"),
  "payload.json",
  join("progressive", "batch.json"),
  "batch.json",
];

export const SOURCE_MANIFEST_FILENAME = "source-manifest.json";

/** Safety ceilings for one package read. */
export const MAX_PACKAGE_FILES = 2000;
export const MAX_MEDIA_FILE_BYTES = 24 * 1024 * 1024; // matches the sanitizer cap
export const MAX_PACKAGE_MEDIA_BYTES = 1024 * 1024 * 1024; // 1 GiB of source media

/** Directory names never treated as publishable media. */
const SKIPPED_DIRECTORIES = new Set([
  "progressive",
  "node_modules",
  ".git",
  ".intake-workspace",
  ".sip-workspace",
]);

export interface SourcePackage {
  /**
   * Stable reference for reports and audit. The package directory's basename,
   * never an absolute path — absolute paths are private system detail.
   */
  ref: string;
  /** Absolute directory the package was read from. Never projected publicly. */
  directory: string;
  batch: ProgressiveBatch;
  media: SourceMediaCandidate[];
  /** Parsed source-manifest.json when present; provenance only. */
  manifest: unknown | null;
  /** Files skipped while reading, with the reason. */
  skipped: Array<{ path: string; reason: string }>;
}

export class SourcePackageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SourcePackageError";
    this.code = code;
  }
}

async function readJsonIfPresent(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as unknown;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw new SourcePackageError(
        "package_payload_invalid",
        `${basename(path)} is not valid JSON.`,
      );
    }
    throw error;
  }
}

/** Recursively list files under a directory, bounded and skipping evidence dirs. */
async function listPackageFiles(
  root: string,
): Promise<{ files: string[]; skipped: Array<{ path: string; reason: string }> }> {
  const files: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const queue: string[] = [root];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        queue.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= MAX_PACKAGE_FILES) {
        skipped.push({ path: logicalPath(root, absolute), reason: "package_file_limit" });
        continue;
      }
      files.push(absolute);
    }
  }
  return { files, skipped };
}

/** Root-relative forward-slash path — the form classifyPath expects. */
function logicalPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

/**
 * Read one source package.
 *
 * `directory` may be any folder on the Owner's machine. The payload must be a
 * ready progressive batch (already carrying `batch_fingerprint`); building a
 * batch from raw extraction output stays the job of the existing intake lane.
 */
export async function readSourcePackage(directory: string): Promise<SourcePackage> {
  let info;
  try {
    info = await stat(directory);
  } catch {
    throw new SourcePackageError(
      "package_not_found",
      `Source package directory not found: ${basename(directory)}`,
    );
  }
  if (!info.isDirectory()) {
    throw new SourcePackageError(
      "package_not_a_directory",
      `Source package must be a directory: ${basename(directory)}`,
    );
  }

  let payload: unknown | null = null;
  for (const candidate of PAYLOAD_CANDIDATE_PATHS) {
    payload = await readJsonIfPresent(join(directory, candidate));
    if (payload) break;
  }
  if (!payload) {
    throw new SourcePackageError(
      "package_payload_missing",
      `No payload.json found in ${basename(directory)} (looked in ${PAYLOAD_CANDIDATE_PATHS.join(", ")}).`,
    );
  }

  // Same structural boundary the trusted ingest client enforces.
  assertProgressiveBatchStructure(payload);
  const batch = payload as ProgressiveBatch;
  if (
    typeof batch.batch_fingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(batch.batch_fingerprint)
  ) {
    throw new SourcePackageError(
      "package_fingerprint_missing",
      "The payload has no valid batch_fingerprint; it is not a ready progressive batch.",
    );
  }

  const manifest = await readJsonIfPresent(join(directory, SOURCE_MANIFEST_FILENAME));

  const { files, skipped } = await listPackageFiles(directory);
  const media: SourceMediaCandidate[] = [];
  let totalBytes = 0;

  for (const absolute of files) {
    const path = logicalPath(directory, absolute);
    if (path === SOURCE_MANIFEST_FILENAME) continue;
    if (
      PAYLOAD_CANDIDATE_PATHS.includes(path.split("/").join(sep)) ||
      path.endsWith("payload.json")
    ) {
      continue;
    }
    const fileInfo = await stat(absolute);
    if (fileInfo.size > MAX_MEDIA_FILE_BYTES) {
      skipped.push({ path, reason: "file_too_large" });
      continue;
    }
    if (totalBytes + fileInfo.size > MAX_PACKAGE_MEDIA_BYTES) {
      skipped.push({ path, reason: "package_byte_budget" });
      continue;
    }
    totalBytes += fileInfo.size;
    media.push({ path, bytes: await readFile(absolute) });
  }

  return { ref: basename(directory), directory, batch, media, manifest, skipped };
}
