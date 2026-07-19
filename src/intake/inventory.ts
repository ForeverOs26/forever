/**
 * Fast Intake v1 — source inventory and classification.
 *
 * Walks every source root (directory or ZIP archive), extracting archives into
 * a gitignored workspace with traversal rejection, hashes each physical file
 * exactly once, classifies it, and detects byte-identical duplicates. Produces
 * the deterministic `source-manifest.json` and `classification.json` shapes.
 *
 * Logical paths are root-relative and forward-slash normalized so the same
 * source input yields the same manifest regardless of the machine's absolute
 * paths. Absolute paths appear only under `local_only_path`.
 */

import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

import { classifyPath } from "./classify";
import { toLogicalPath } from "./fs-utils";
import { DEFAULT_ZIP_LIMITS, extractZip, ZipLimitError, type ZipLimits } from "./zip";
import type {
  ClassificationEntry,
  ClassificationReport,
  IntakeCategory,
  IntakeExtractionSupport,
  IntakeWarning,
  SourceManifest,
  SourceManifestFile,
  SourceRootManifest,
} from "./types";
import { INTAKE_CATEGORIES, INTAKE_SCHEMA_VERSION } from "./types";

export interface PhysicalFile {
  logicalPath: string;
  absolutePath: string;
  originalFilename: string;
  extension: string;
  category: IntakeCategory;
  extractionSupport: IntakeExtractionSupport;
  byteSize: number;
  sha256: string;
  archiveOrigin: { root: string; entry: string } | null;
}

export interface InventoryResult {
  manifest: SourceManifest;
  classification: ClassificationReport;
  physicalFiles: PhysicalFile[];
  intakeWarnings: IntakeWarning[];
}

export interface InventoryInput {
  projectSlug: string;
  sources: string[];
  /** Gitignored directory for archive extraction; cleaned by the caller. */
  workspaceDir: string;
  intakeStartedAt: string;
  /** ZIP resource limits; conservative defaults when omitted. */
  zipLimits?: ZipLimits;
}

function hashFile(absPath: string): { sha256: string; byteSize: number } {
  const hash = createHash("sha256");
  const fd = openSync(absPath, "r");
  let byteSize = 0;
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      byteSize += bytesRead;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return { sha256: hash.digest("hex"), byteSize };
}

function walkDirectory(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkDirectory(full));
    } else if (entry.isFile()) {
      found.push(full);
    }
  }
  return found;
}

function normalizeExtension(name: string): string {
  return extname(name).toLowerCase();
}

/** Build the inventory across all source roots. Throws on unreadable sources. */
export function buildInventory(input: InventoryInput): InventoryResult {
  const roots: SourceRootManifest[] = [];
  const physicalFiles: PhysicalFile[] = [];
  const zipLimits = input.zipLimits ?? DEFAULT_ZIP_LIMITS;

  input.sources.forEach((source, index) => {
    const abs = resolve(source);
    const rootId = `root-${index}`;
    const stats = statSync(abs);
    const isZip = stats.isFile() && normalizeExtension(abs) === ".zip";

    if (isZip) {
      // Reject an oversized archive before reading it into memory.
      if (stats.size > zipLimits.maxArchiveBytes) {
        throw new ZipLimitError(
          `zip_archive_too_large: ${stats.size} > ${zipLimits.maxArchiveBytes}`,
        );
      }
      roots.push({ id: rootId, kind: "archive", name: basename(abs), local_only_path: abs });
      const destDir = join(input.workspaceDir, rootId);
      const extracted = extractZip(readFileSync(abs), destDir, zipLimits);
      for (const file of extracted) {
        physicalFiles.push(
          describeFile(rootId, file.relativePath, file.absolutePath, {
            root: rootId,
            entry: file.relativePath,
          }),
        );
      }
      return;
    }

    if (stats.isFile()) {
      // A single non-archive file provided directly as a source.
      roots.push({ id: rootId, kind: "directory", name: basename(abs), local_only_path: abs });
      physicalFiles.push(describeFile(rootId, basename(abs), abs, null));
      return;
    }

    if (!stats.isDirectory()) {
      throw new Error(`intake_source_unsupported: ${source}`);
    }
    roots.push({ id: rootId, kind: "directory", name: basename(abs), local_only_path: abs });
    for (const absFile of walkDirectory(abs)) {
      const relative = toLogicalPath(absFile.slice(abs.length + 1));
      physicalFiles.push(describeFile(rootId, relative, absFile, null));
    }
  });

  // Deterministic ordering independent of filesystem enumeration order.
  physicalFiles.sort((a, b) =>
    a.logicalPath < b.logicalPath ? -1 : a.logicalPath > b.logicalPath ? 1 : 0,
  );

  const seenHash = new Set<string>();
  const intakeWarnings: IntakeWarning[] = [];
  const manifestFiles: SourceManifestFile[] = [];
  const classificationEntries: ClassificationEntry[] = [];
  const categoryCounts = Object.fromEntries(
    INTAKE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<IntakeCategory, number>;
  const structuredArtifacts: string[] = [];
  let duplicateCount = 0;
  let supportedCount = 0;
  let unsupportedCount = 0;

  for (const file of physicalFiles) {
    const isPrimary = !seenHash.has(file.sha256);
    if (isPrimary) seenHash.add(file.sha256);
    else duplicateCount += 1;

    const warningCodes: string[] = [];
    if (file.category === "unknown") {
      warningCodes.push("unknown_file");
      intakeWarnings.push({
        code: "unknown_file",
        severity: "info",
        message: `Unrecognized file was inventoried but not extracted: ${file.logicalPath}`,
        logical_path: file.logicalPath,
      });
    }
    if (file.category === "archive") {
      warningCodes.push("nested_archive");
      intakeWarnings.push({
        code: "nested_archive",
        severity: "warning",
        message: `Nested archive was not recursively unpacked in v1: ${file.logicalPath}`,
        logical_path: file.logicalPath,
      });
    }
    if (!isPrimary) {
      warningCodes.push("duplicate_file");
    }

    categoryCounts[file.category] += 1;
    if (file.category === "unknown") unsupportedCount += 1;
    else supportedCount += 1;
    if (file.extractionSupport === "structured") structuredArtifacts.push(file.logicalPath);

    manifestFiles.push({
      logical_path: file.logicalPath,
      original_filename: file.originalFilename,
      extension: file.extension,
      category: file.category,
      byte_size: file.byteSize,
      sha256: file.sha256,
      duplicate_group: file.sha256,
      duplicate_primary: isPrimary,
      archive_origin: file.archiveOrigin,
      extraction_support: file.extractionSupport,
      supported: file.category !== "unknown",
      warning_codes: warningCodes,
    });
    classificationEntries.push({
      logical_path: file.logicalPath,
      category: file.category,
      extraction_support: file.extractionSupport,
      warning_codes: warningCodes,
    });
  }

  if (duplicateCount > 0) {
    intakeWarnings.push({
      code: "duplicate_sources",
      severity: "info",
      message: `${duplicateCount} byte-identical duplicate source file(s) detected and de-duplicated by SHA-256.`,
    });
  }
  const inventoriedUnsupported = physicalFiles.filter(
    (file) => file.extractionSupport === "inventoried",
  ).length;
  if (inventoriedUnsupported > 0) {
    intakeWarnings.push({
      code: "unsupported_source_for_extraction",
      severity: "info",
      message: `${inventoriedUnsupported} recognized raw source file(s) were inventoried but not extracted in v1 (no OCR/CV/spreadsheet extraction).`,
    });
  }

  const manifest: SourceManifest = {
    intake_schema_version: INTAKE_SCHEMA_VERSION,
    project_slug: input.projectSlug,
    intake_started_at: input.intakeStartedAt,
    source_roots: roots,
    file_count: manifestFiles.length,
    duplicate_count: duplicateCount,
    files: manifestFiles,
  };

  const classification: ClassificationReport = {
    intake_schema_version: INTAKE_SCHEMA_VERSION,
    project_slug: input.projectSlug,
    category_counts: categoryCounts,
    supported_count: supportedCount,
    unsupported_count: unsupportedCount,
    structured_artifacts: [...structuredArtifacts].sort(),
    entries: classificationEntries,
    intake_warnings: intakeWarnings,
  };

  return { manifest, classification, physicalFiles, intakeWarnings };
}

function describeFile(
  rootId: string,
  relativePath: string,
  absolutePath: string,
  archiveOrigin: { root: string; entry: string } | null,
): PhysicalFile {
  const logicalPath = toLogicalPath(rootId, relativePath);
  const originalFilename = basename(relativePath);
  const extension = normalizeExtension(originalFilename);
  const { category, extraction_support } = classifyPath(logicalPath);
  const { sha256, byteSize } = hashFile(absolutePath);
  return {
    logicalPath,
    absolutePath,
    originalFilename,
    extension,
    category,
    extractionSupport: extraction_support,
    byteSize,
    sha256,
    archiveOrigin,
  };
}
