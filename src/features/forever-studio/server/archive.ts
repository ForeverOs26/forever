/**
 * Forever Studio — hardened ZIP expansion (complete safety contract).
 *
 * Reuses the Fast Intake ZIP reader's FULL entry-set validation — never only
 * the low-level entry reader. Before any entry is decompressed the whole
 * archive passes: archive-size limit, entry-count limit, per-entry and total
 * expanded-size limits, compression-ratio limit, traversal/absolute/drive/UNC
 * rejection, Windows reserved names, symlink rejection, encrypted-entry
 * rejection, ZIP64 rejection, unsupported compression rejection, duplicate and
 * case-insensitive collisions, and file/directory collisions. Each entry is
 * then decompressed ONE AT A TIME (CRC-32 and declared size verified) and
 * handed to the caller's callback, so the expanded archive is never
 * materialized in memory all at once.
 *
 * A dangerous or unsupported archive is fail-closed: no entry is expanded, a
 * concise warning is returned, and the raw archive stays privately retained —
 * it never blocks publication from the job's other usable materials.
 */

import type { ProgressiveWarning } from "@/features/forever-ingestion/batch-types";
import {
  DEFAULT_ZIP_LIMITS,
  readZipEntries,
  readZipEntryData,
  rejectZip64,
  validateZipEntries,
  ZipError,
  type ZipLimits,
} from "@/intake/zip";

/**
 * Studio-specific ZIP limits: tighter than the Fast Intake CLI defaults
 * because expansion happens inside a memory-limited server request. The
 * per-entry cap also bounds peak memory (one entry at a time).
 */
export const STUDIO_ZIP_LIMITS: ZipLimits = {
  // The archive buffer and one inflated entry coexist in a Worker request.
  // Keep their peak well below the practical 128 MiB runtime envelope.
  maxArchiveBytes: 16 * 1024 * 1024, // matches MAX_ARCHIVE_BYTES
  maxEntries: 300,
  maxFileBytes: 8 * 1024 * 1024, // one expanded entry at a time in memory
  maxTotalBytes: 64 * 1024 * 1024,
  maxCompressionRatio: DEFAULT_ZIP_LIMITS.maxCompressionRatio,
  maxPathLength: 1024,
};

/** Containment root for path validation only — nothing is ever written here. */
const VIRTUAL_DEST = "/forever-studio-zip-virtual";

export interface StudioArchiveEntry {
  name: string;
  data: Buffer;
}

export interface StudioArchiveResult {
  /** True when the entry set validated and every entry was offered. */
  expanded: boolean;
  warnings: ProgressiveWarning[];
}

function archiveWarning(code: string, fileName: string, message: string): ProgressiveWarning {
  return {
    entity: "document",
    code,
    severity: "warning",
    message,
    payload: { file: fileName },
  };
}

/** Concise, safe reason for a rejected archive (no raw entry paths or limits). */
function rejectionReason(error: unknown): string {
  if (error instanceof ZipError) {
    const kind = error.message.split(":")[0].trim();
    return kind || error.name;
  }
  return "unreadable";
}

/**
 * Validate the complete entry set, then stream entries one at a time through
 * `onEntry`. Set-level failures expand nothing; a single-entry integrity
 * failure mid-stream stops further expansion with a warning. Never throws.
 */
export async function extractStudioArchive(
  input: { fileName: string; buffer: Buffer },
  onEntry: (entry: StudioArchiveEntry) => Promise<void>,
  limits: ZipLimits = STUDIO_ZIP_LIMITS,
): Promise<StudioArchiveResult> {
  const warnings: ProgressiveWarning[] = [];
  if (!input.fileName.toLowerCase().endsWith(".zip")) {
    warnings.push(
      archiveWarning(
        "archive_format_unsupported",
        input.fileName,
        `${input.fileName} is not a ZIP archive; the file was retained unexpanded.`,
      ),
    );
    return { expanded: false, warnings };
  }

  let entries;
  try {
    // FULL safety contract before any expansion (fail closed, expand nothing).
    rejectZip64(input.buffer);
    entries = readZipEntries(input.buffer);
    validateZipEntries(input.buffer, entries, limits, VIRTUAL_DEST);
  } catch (error) {
    warnings.push(
      archiveWarning(
        "archive_rejected_unsafe",
        input.fileName,
        `${input.fileName} was rejected by archive safety checks (${rejectionReason(error)}); it was retained privately and did not block the rest of the upload.`,
      ),
    );
    return { expanded: false, warnings };
  }

  // One entry at a time: decompress, verify CRC + declared size, hand over,
  // release. The running total re-checks the expansion budget with ACTUAL
  // bytes as defense in depth over the declared-size validation above.
  let totalExpanded = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    let data: Buffer;
    try {
      data = readZipEntryData(input.buffer, entry, limits);
      totalExpanded += data.length;
      if (totalExpanded > limits.maxTotalBytes) {
        warnings.push(
          archiveWarning(
            "archive_rejected_unsafe",
            input.fileName,
            `${input.fileName} expanded past the safe total size; remaining entries were retained unexpanded.`,
          ),
        );
        return { expanded: false, warnings };
      }
    } catch (error) {
      warnings.push(
        archiveWarning(
          "archive_entry_integrity_failed",
          input.fileName,
          `${input.fileName} failed integrity verification mid-archive (${rejectionReason(error)}); remaining entries were retained unexpanded.`,
        ),
      );
      return { expanded: false, warnings };
    }
    await onEntry({ name: entry.name, data });
  }
  return { expanded: true, warnings };
}
