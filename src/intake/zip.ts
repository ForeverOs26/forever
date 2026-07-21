/**
 * Fast Intake v1 — a hardened, dependency-free, deterministic ZIP reader.
 *
 * ZIP archives are treated as UNTRUSTED input. Built only on `node:zlib` (raw
 * DEFLATE) and `node:fs`, this reader:
 *  - enforces conservative, configurable resource limits (archive size, entry
 *    count, single/total expanded size, compression ratio, path length);
 *  - rejects every traversal and unsafe-name variant BEFORE any write;
 *  - rejects encrypted entries, unsupported compression, ZIP64, symlink-like
 *    entries, duplicate/colliding names, and file/directory collisions;
 *  - verifies CRC-32 and declared sizes for every extracted file;
 *  - never recursively unpacks nested archives;
 *  - removes all partial extraction data after any failure.
 *
 * Anything unsupported fails closed with a concise deterministic error.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

import { removeManagedDir } from "./paths";

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL_32 = 0xffffffff;
const ZIP64_SENTINEL_16 = 0xffff;

export interface ZipLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxCompressionRatio: number;
  maxPathLength: number;
}

/** Conservative defaults; generous enough for a normal developer dossier. */
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxArchiveBytes: 2 * 1024 * 1024 * 1024, // 2 GiB archive
  maxEntries: 100_000,
  maxFileBytes: 1 * 1024 * 1024 * 1024, // 1 GiB per expanded file
  maxTotalBytes: 8 * 1024 * 1024 * 1024, // 8 GiB total expanded
  maxCompressionRatio: 200,
  maxPathLength: 4096,
};

// Only enforce the compression ratio above this size so tiny incompressible
// files (ratio ≈ 1) are never penalized.
const RATIO_MIN_UNCOMPRESSED = 1024 * 1024;

export class ZipError extends Error {}
export class ZipTraversalError extends ZipError {
  constructor(public readonly entryName: string) {
    super(`zip_path_traversal_rejected: ${entryName}`);
    this.name = "ZipTraversalError";
  }
}
export class ZipLimitError extends ZipError {
  constructor(message: string) {
    super(message);
    this.name = "ZipLimitError";
  }
}
export class ZipUnsupportedError extends ZipError {
  constructor(message: string) {
    super(message);
    this.name = "ZipUnsupportedError";
  }
}
export class ZipIntegrityError extends ZipError {
  constructor(message: string) {
    super(message);
    this.name = "ZipIntegrityError";
  }
}
export class ZipCollisionError extends ZipError {
  constructor(message: string) {
    super(message);
    this.name = "ZipCollisionError";
  }
}

export interface ZipEntry {
  /** The raw name as stored, separators normalized to forward slash. */
  name: string;
  isDirectory: boolean;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  externalAttributes: number;
}

// ---------------------------------------------------------------------------
// CRC-32
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Central-directory parsing (bounds-checked, authoritative)
// ---------------------------------------------------------------------------

function need(buffer: Buffer, offset: number, length: number): void {
  if (offset < 0 || offset + length > buffer.length) {
    throw new ZipIntegrityError("zip_central_directory_truncated");
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minSize = 22;
  if (buffer.length < minSize) throw new ZipIntegrityError("zip_truncated");
  const earliest = Math.max(0, buffer.length - minSize - 0xffff);
  for (let offset = buffer.length - minSize; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new ZipIntegrityError("zip_end_of_central_directory_not_found");
}

export function rejectZip64(buffer: Buffer): void {
  // A ZIP64 end-of-central-directory locator anywhere in the archive means the
  // archive relies on ZIP64 structures this reader intentionally does not read.
  for (let offset = 0; offset + 4 <= buffer.length; offset += 1) {
    if (buffer.readUInt32LE(offset) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
      throw new ZipUnsupportedError("zip64_unsupported");
    }
  }
}

/** Enumerate entries from the central directory with full bounds checking. */
export function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  const diskEntries = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  if (diskEntries !== totalEntries) {
    throw new ZipUnsupportedError("zip_multi_disk_unsupported");
  }
  if (totalEntries === ZIP64_SENTINEL_16) {
    throw new ZipUnsupportedError("zip64_unsupported");
  }
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < totalEntries; index += 1) {
    need(buffer, offset, 46);
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new ZipIntegrityError("zip_central_directory_corrupt");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    if (
      compressedSize === ZIP64_SENTINEL_32 ||
      uncompressedSize === ZIP64_SENTINEL_32 ||
      localHeaderOffset === ZIP64_SENTINEL_32
    ) {
      throw new ZipUnsupportedError("zip64_unsupported");
    }

    need(buffer, offset + 46, nameLength);
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const name = rawName.split("\\").join("/");
    entries.push({
      name,
      isDirectory: name.endsWith("/"),
      method,
      flags,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      externalAttributes,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Entry-name safety
// ---------------------------------------------------------------------------

const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

// Control characters (incl. NUL) plus the Windows-invalid set. `/` is the
// separator and `\` is normalized away before this check; a legitimate drive
// colon is rejected by the drive-letter branch, so any `:` reaching here is
// unsafe. Space and `-` are valid and intentionally NOT included.
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[\u0000-\u001f<>:"|?*]/;

/**
 * Reject every unsafe entry name variant before it is used. `rawName` is the
 * name as stored (may contain backslashes); it is normalized to forward slashes
 * for inspection. A directory trailing slash is allowed and stripped for the
 * per-segment checks.
 */
export function assertSafeEntryName(
  rawName: string,
  maxPathLength = DEFAULT_ZIP_LIMITS.maxPathLength,
): void {
  const normalized = rawName.split("\\").join("/");
  if (normalized.length === 0) throw new ZipTraversalError(rawName);
  if (normalized.length > maxPathLength) {
    throw new ZipLimitError(`zip_entry_path_too_long: ${normalized.length} > ${maxPathLength}`);
  }
  // Absolute / leading separator / drive letter / UNC — reject first.
  if (normalized.startsWith("/")) throw new ZipTraversalError(rawName);
  if (isAbsolute(normalized)) throw new ZipTraversalError(rawName);
  if (/^[A-Za-z]:/.test(normalized)) throw new ZipTraversalError(rawName);
  if (rawName.startsWith("\\\\") || normalized.startsWith("//"))
    throw new ZipTraversalError(rawName);
  // NUL / control / Windows-invalid characters anywhere else.
  if (INVALID_CHARS.test(normalized)) throw new ZipTraversalError(rawName);

  const segments = normalized.replace(/\/+$/, "").split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new ZipTraversalError(rawName);
    }
    if (segment.endsWith(".") || segment.endsWith(" ")) {
      // Trailing dot/space is silently stripped by Windows → unsafe collision.
      throw new ZipTraversalError(rawName);
    }
    const base = segment.split(".")[0].toLowerCase();
    if (WINDOWS_RESERVED.has(base)) throw new ZipTraversalError(rawName);
  }
}

/** Resolve a validated entry name to a path strictly inside `destDir`. */
export function safeJoinInside(destDir: string, entryName: string, maxPathLength?: number): string {
  assertSafeEntryName(entryName, maxPathLength);
  const normalizedName = entryName.split("\\").join("/").replace(/\/+$/, "");
  const destRoot = resolve(destDir);
  const target = resolve(destRoot, normalizedName);
  const rel = relative(destRoot, target);
  if (rel === "" || rel === ".") return target;
  if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
    throw new ZipTraversalError(entryName);
  }
  return target;
}

// ---------------------------------------------------------------------------
// Validation of the whole entry set
// ---------------------------------------------------------------------------

function isSymlink(entry: ZipEntry): boolean {
  const unixMode = (entry.externalAttributes >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

export function validateZipEntries(
  buffer: Buffer,
  entries: ZipEntry[],
  limits: ZipLimits,
  destDir: string,
): void {
  if (buffer.length > limits.maxArchiveBytes) {
    throw new ZipLimitError(`zip_archive_too_large: ${buffer.length} > ${limits.maxArchiveBytes}`);
  }
  if (entries.length > limits.maxEntries) {
    throw new ZipLimitError(`zip_too_many_entries: ${entries.length} > ${limits.maxEntries}`);
  }

  const exactPaths = new Set<string>();
  const lowerPaths = new Set<string>();
  const canonicalCase = new Map<string, string>();
  const filePaths = new Set<string>();
  const dirPaths = new Set<string>();
  let totalUncompressed = 0;

  for (const entry of entries) {
    // Path safety + containment (throws before any write).
    safeJoinInside(destDir, entry.name, limits.maxPathLength);
    const normalized = entry.name.split("\\").join("/").replace(/\/+$/, "");

    // Windows resolves every segment case-insensitively. Check both explicit
    // entry names and implicit ancestor directories so `A/x` and `a/y` cannot
    // merge into one on-disk tree.
    const parts = normalized.split("/");
    for (let index = 1; index <= parts.length; index += 1) {
      const partial = parts.slice(0, index).join("/");
      const lower = partial.toLowerCase();
      const prior = canonicalCase.get(lower);
      if (prior !== undefined && prior !== partial) {
        throw new ZipCollisionError(`zip_case_insensitive_collision: ${entry.name}`);
      }
      canonicalCase.set(lower, partial);
    }
    if (exactPaths.has(normalized)) {
      throw new ZipCollisionError(`zip_duplicate_entry: ${entry.name}`);
    }
    const normalizedLower = normalized.toLowerCase();
    if (lowerPaths.has(normalizedLower)) {
      throw new ZipCollisionError(`zip_case_insensitive_collision: ${entry.name}`);
    }
    exactPaths.add(normalized);
    lowerPaths.add(normalizedLower);

    if (isSymlink(entry)) {
      throw new ZipUnsupportedError(`zip_symlink_entry_rejected: ${entry.name}`);
    }
    if ((entry.flags & 0x1) !== 0) {
      throw new ZipUnsupportedError(`zip_encrypted_entry_rejected: ${entry.name}`);
    }

    if (entry.isDirectory) {
      dirPaths.add(normalized);
    } else {
      if (entry.method !== 0 && entry.method !== 8) {
        throw new ZipUnsupportedError(`zip_unsupported_compression_method: ${entry.method}`);
      }
      if (entry.method === 0 && entry.compressedSize !== entry.uncompressedSize) {
        throw new ZipIntegrityError(`zip_stored_size_mismatch: ${entry.name}`);
      }
      if (entry.uncompressedSize > limits.maxFileBytes) {
        throw new ZipLimitError(
          `zip_file_too_large: ${entry.name} ${entry.uncompressedSize} > ${limits.maxFileBytes}`,
        );
      }
      if (
        entry.uncompressedSize > RATIO_MIN_UNCOMPRESSED &&
        entry.compressedSize > 0 &&
        entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio
      ) {
        throw new ZipLimitError(`zip_compression_ratio_exceeded: ${entry.name}`);
      }
      totalUncompressed += entry.uncompressedSize;
      if (totalUncompressed > limits.maxTotalBytes) {
        throw new ZipLimitError(
          `zip_total_expanded_too_large: ${totalUncompressed} > ${limits.maxTotalBytes}`,
        );
      }

      filePaths.add(normalized);
      // Every ancestor of this file is a directory.
      const parts = normalized.split("/");
      for (let i = 1; i < parts.length; i += 1) dirPaths.add(parts.slice(0, i).join("/"));
    }
  }

  // File / directory collisions: a path used as both a file and a directory.
  for (const filePath of filePaths) {
    if (dirPaths.has(filePath)) {
      throw new ZipCollisionError(`zip_file_directory_collision: ${filePath}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Decompression + integrity
// ---------------------------------------------------------------------------

/** Decompress and verify one entry (CRC-32 + declared length). */
export function readZipEntryData(
  buffer: Buffer,
  entry: ZipEntry,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): Buffer {
  if (entry.isDirectory) return Buffer.alloc(0);
  need(buffer, entry.localHeaderOffset, 30);
  if (buffer.readUInt32LE(entry.localHeaderOffset) !== LOCAL_SIGNATURE) {
    throw new ZipIntegrityError("zip_local_header_corrupt");
  }
  const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  need(buffer, dataStart, entry.compressedSize);
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  let data: Buffer;
  if (entry.method === 0) {
    data = Buffer.from(compressed);
  } else if (entry.method === 8) {
    try {
      data = inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
    } catch {
      throw new ZipIntegrityError(`zip_inflate_failed: ${entry.name}`);
    }
  } else {
    throw new ZipUnsupportedError(`zip_unsupported_compression_method: ${entry.method}`);
  }

  if (data.length !== entry.uncompressedSize) {
    throw new ZipIntegrityError(`zip_size_mismatch: ${entry.name}`);
  }
  if (data.length > limits.maxFileBytes) {
    throw new ZipLimitError(`zip_file_too_large: ${entry.name}`);
  }
  if (crc32(data) !== entry.crc32) {
    throw new ZipIntegrityError(`zip_crc_mismatch: ${entry.name}`);
  }
  return data;
}

export interface ExtractedZipFile {
  /** Path relative to destDir, forward-slash normalized. */
  relativePath: string;
  absolutePath: string;
  uncompressedSize: number;
}

/**
 * Validate the whole archive, then extract every file entry into `destDir`.
 * All safety and limit checks run BEFORE any write. On any failure the partial
 * `destDir` is removed and the error is rethrown (fail closed).
 */
export function extractZip(
  buffer: Buffer,
  destDir: string,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): ExtractedZipFile[] {
  if (existsSync(resolve(destDir))) {
    throw new ZipCollisionError(`zip_destination_exists: ${resolve(destDir)}`);
  }
  rejectZip64(buffer);
  const entries = readZipEntries(buffer);
  validateZipEntries(buffer, entries, limits, destDir);

  const written: ExtractedZipFile[] = [];
  try {
    mkdirSync(destDir, { recursive: true });
    let totalWritten = 0;
    for (const entry of entries) {
      const target = safeJoinInside(destDir, entry.name, limits.maxPathLength);
      if (entry.isDirectory) {
        mkdirSync(target, { recursive: true });
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      const data = readZipEntryData(buffer, entry, limits);
      totalWritten += data.length;
      if (totalWritten > limits.maxTotalBytes) {
        throw new ZipLimitError(
          `zip_total_expanded_too_large: ${totalWritten} > ${limits.maxTotalBytes}`,
        );
      }
      writeFileSync(target, data);
      written.push({
        relativePath: entry.name.replace(/\/+$/, ""),
        absolutePath: target,
        uncompressedSize: data.length,
      });
    }
    return written;
  } catch (error) {
    // Clean partial extraction data after any failure.
    try {
      removeManagedDir(destDir, [dirname(resolve(destDir))]);
    } catch {
      // Never mask the original error with a cleanup error.
    }
    throw error;
  }
}
