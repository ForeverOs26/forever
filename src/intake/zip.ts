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
  /**
   * The EXACT stored name bytes, latin1-decoded (byte-preserving). Used to
   * bind each entry's LOCAL header to its central-directory record before
   * any payload is read — a local record naming different bytes is rejected.
   */
  rawName: string;
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

export function zipCrc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Incremental CRC-32 over a chunked stream: seed with ZIP_CRC32_SEED, fold
// each chunk through zipCrc32Update, then zipCrc32Finish. Identical result to
// zipCrc32 over the concatenation (asserted by the ranged-reader tests).
export const ZIP_CRC32_SEED = 0xffffffff;

export function zipCrc32Update(state: number, chunk: Buffer): number {
  let crc = state >>> 0;
  for (let i = 0; i < chunk.length; i += 1) {
    crc = CRC_TABLE[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

export function zipCrc32Finish(state: number): number {
  return (state ^ 0xffffffff) >>> 0;
}

const crc32 = zipCrc32;

// ---------------------------------------------------------------------------
// Central-directory parsing (bounds-checked, authoritative)
// ---------------------------------------------------------------------------

function need(buffer: Buffer, offset: number, length: number): void {
  if (offset < 0 || offset + length > buffer.length) {
    throw new ZipIntegrityError("zip_central_directory_truncated");
  }
}

/**
 * Locate the ONE structurally valid end-of-central-directory record. A
 * candidate is valid only when its declared comment consumes EXACTLY the rest
 * of the file (candidateOffset + 22 + commentLength == EOF) — a fake EOCD
 * signature embedded in a comment or arbitrary trailing bytes fails this rule.
 * Multi-disk markers reject, and if MORE than one exact-EOF candidate exists
 * the archive is structurally ambiguous and rejected outright (two parsers
 * could disagree about its contents).
 */
export function findEndOfCentralDirectory(buffer: Buffer): number {
  const minSize = 22;
  if (buffer.length < minSize) throw new ZipIntegrityError("zip_truncated");
  const earliest = Math.max(0, buffer.length - minSize - 0xffff);
  const candidates: number[] = [];
  for (let offset = buffer.length - minSize; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + minSize + commentLength !== buffer.length) continue;
    if (buffer.readUInt16LE(offset + 4) !== 0 || buffer.readUInt16LE(offset + 6) !== 0) {
      throw new ZipUnsupportedError("zip_multi_disk_unsupported");
    }
    candidates.push(offset);
  }
  if (candidates.length === 0) {
    throw new ZipIntegrityError("zip_end_of_central_directory_not_found");
  }
  if (candidates.length > 1) {
    throw new ZipIntegrityError("zip_ambiguous_end_of_central_directory");
  }
  return candidates[0];
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
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (cdSize === ZIP64_SENTINEL_32 || cdOffset === ZIP64_SENTINEL_32) {
    throw new ZipUnsupportedError("zip64_unsupported");
  }
  // The central directory must sit flush against the EOCD and consume
  // exactly its declared byte size — no gaps, no trailing structure.
  if (cdOffset + cdSize !== eocd) {
    throw new ZipIntegrityError("zip_central_directory_bounds_invalid");
  }
  let offset = cdOffset;
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
    const diskNumberStart = buffer.readUInt16LE(offset + 34);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    if (diskNumberStart !== 0) {
      throw new ZipUnsupportedError("zip_multi_disk_unsupported");
    }
    if (
      compressedSize === ZIP64_SENTINEL_32 ||
      uncompressedSize === ZIP64_SENTINEL_32 ||
      localHeaderOffset === ZIP64_SENTINEL_32
    ) {
      throw new ZipUnsupportedError("zip64_unsupported");
    }

    need(buffer, offset + 46, nameLength);
    const rawNameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength);
    const rawName = rawNameBytes.toString("latin1");
    const name = rawNameBytes.toString("utf8").split("\\").join("/");
    entries.push({
      name,
      rawName,
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
    if (offset > eocd) {
      throw new ZipIntegrityError("zip_central_directory_truncated");
    }
  }
  // Exactly the declared central-directory bytes must have been consumed.
  if (offset !== cdOffset + cdSize) {
    throw new ZipIntegrityError("zip_central_directory_size_mismatch");
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
  validateZipEntrySet(buffer.length, entries, limits, destDir);
}

/**
 * The complete entry-set safety contract, expressed against the archive's
 * byte length rather than a materialized buffer so range-based readers (which
 * never hold the whole archive in memory) enforce the identical contract.
 */
export function validateZipEntrySet(
  archiveByteLength: number,
  entries: ZipEntry[],
  limits: ZipLimits,
  destDir: string,
): void {
  if (archiveByteLength > limits.maxArchiveBytes) {
    throw new ZipLimitError(
      `zip_archive_too_large: ${archiveByteLength} > ${limits.maxArchiveBytes}`,
    );
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

  // Claimed local records must be pairwise disjoint: each entry occupies at
  // least [localHeaderOffset, localHeaderOffset + 30 + nameBytes +
  // compressedSize). Overlapping spans (including duplicate local offsets, a
  // local header pointing into another entry, or one entry's data covering
  // another's record) are rejected before anything is read.
  const spans = entries
    .map((entry) => ({
      name: entry.name,
      start: entry.localHeaderOffset,
      end: entry.localHeaderOffset + 30 + entry.rawName.length + entry.compressedSize,
    }))
    .sort((left, right) => left.start - right.start);
  for (let index = 0; index < spans.length; index += 1) {
    if (spans[index].end > archiveByteLength) {
      throw new ZipIntegrityError(`zip_entry_out_of_bounds: ${spans[index].name}`);
    }
    if (index > 0 && spans[index].start < spans[index - 1].end) {
      throw new ZipIntegrityError(`zip_overlapping_entries: ${spans[index].name}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Local-header binding (shared by the buffered and range-based readers)
// ---------------------------------------------------------------------------

/** General-purpose flag bit 3: sizes/CRC live in a trailing data descriptor. */
export const ZIP_FLAG_DATA_DESCRIPTOR = 0x8;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
/** Flag bits that must agree between the central and local records:
 *  encryption (0), data descriptor (3), and UTF-8 name encoding (11). */
const LOCAL_BINDING_FLAG_MASK = 0x1 | 0x8 | 0x800;

export interface LocalHeaderFields {
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Exact stored local name bytes, latin1-decoded (byte-preserving). */
  rawName: string;
}

/**
 * Bind one entry's LOCAL header to its central-directory record before any
 * payload byte is read: exact name bytes, compression method, the relevant
 * general-purpose flags, encryption state, and — when bit 3 is clear — the
 * CRC and both sizes. With bit 3 set the local fields must be zero and the
 * real values are checked in the trailing data descriptor. Central-directory
 * metadata is never trusted to describe bytes a DIFFERENT local record owns.
 */
export function assertLocalHeaderBinding(entry: ZipEntry, local: LocalHeaderFields): void {
  if (local.rawName !== entry.rawName) {
    throw new ZipIntegrityError(`zip_local_header_mismatch: name: ${entry.name}`);
  }
  if (local.method !== entry.method) {
    throw new ZipIntegrityError(`zip_local_header_mismatch: method: ${entry.name}`);
  }
  if ((local.flags & 0x1) !== 0) {
    throw new ZipUnsupportedError(`zip_encrypted_entry_rejected: ${entry.name}`);
  }
  if ((local.flags & LOCAL_BINDING_FLAG_MASK) !== (entry.flags & LOCAL_BINDING_FLAG_MASK)) {
    throw new ZipIntegrityError(`zip_local_header_mismatch: flags: ${entry.name}`);
  }
  if ((entry.flags & ZIP_FLAG_DATA_DESCRIPTOR) !== 0) {
    // Spec: with bit 3 the local CRC/size fields are recorded as zero and
    // the true values follow the data in the descriptor.
    if (local.crc32 !== 0 || local.compressedSize !== 0 || local.uncompressedSize !== 0) {
      throw new ZipIntegrityError(`zip_local_header_mismatch: descriptor_fields: ${entry.name}`);
    }
  } else if (
    local.crc32 !== entry.crc32 ||
    local.compressedSize !== entry.compressedSize ||
    local.uncompressedSize !== entry.uncompressedSize
  ) {
    throw new ZipIntegrityError(`zip_local_header_mismatch: sizes: ${entry.name}`);
  }
}

/**
 * Validate a data descriptor (bit 3): the 12 value bytes — optionally
 * preceded by the descriptor signature — must equal the central record's
 * CRC-32, compressed size, and uncompressed size exactly.
 */
export function assertDataDescriptor(entry: ZipEntry, descriptor: Buffer): void {
  const matchesAt = (offset: number): boolean =>
    descriptor.length >= offset + 12 &&
    descriptor.readUInt32LE(offset) === entry.crc32 &&
    descriptor.readUInt32LE(offset + 4) === entry.compressedSize &&
    descriptor.readUInt32LE(offset + 8) === entry.uncompressedSize;
  const signed = descriptor.length >= 4 && descriptor.readUInt32LE(0) === DATA_DESCRIPTOR_SIGNATURE;
  if (!(signed && matchesAt(4)) && !matchesAt(0)) {
    throw new ZipIntegrityError(`zip_data_descriptor_mismatch: ${entry.name}`);
  }
}

// ---------------------------------------------------------------------------
// Decompression + integrity
// ---------------------------------------------------------------------------

/**
 * Decompress and verify one entry (local-header binding, then CRC-32 +
 * declared length). `dataEndLimit` is the exclusive upper bound this entry
 * (payload plus any data descriptor) may occupy — callers that know the whole
 * entry set pass the next entry's local header offset (or the central
 * directory start) so one entry can never read bytes belonging to another.
 */
export function readZipEntryData(
  buffer: Buffer,
  entry: ZipEntry,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
  dataEndLimit?: number,
): Buffer {
  if (entry.isDirectory) return Buffer.alloc(0);
  need(buffer, entry.localHeaderOffset, 30);
  if (buffer.readUInt32LE(entry.localHeaderOffset) !== LOCAL_SIGNATURE) {
    throw new ZipIntegrityError("zip_local_header_corrupt");
  }
  const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  need(buffer, entry.localHeaderOffset + 30, nameLength);
  assertLocalHeaderBinding(entry, {
    flags: buffer.readUInt16LE(entry.localHeaderOffset + 6),
    method: buffer.readUInt16LE(entry.localHeaderOffset + 8),
    crc32: buffer.readUInt32LE(entry.localHeaderOffset + 14),
    compressedSize: buffer.readUInt32LE(entry.localHeaderOffset + 18),
    uncompressedSize: buffer.readUInt32LE(entry.localHeaderOffset + 22),
    rawName: buffer
      .subarray(entry.localHeaderOffset + 30, entry.localHeaderOffset + 30 + nameLength)
      .toString("latin1"),
  });
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  need(buffer, dataStart, entry.compressedSize);
  let occupiedEnd = dataStart + entry.compressedSize;
  if ((entry.flags & ZIP_FLAG_DATA_DESCRIPTOR) !== 0) {
    need(buffer, occupiedEnd, 12);
    const descriptor = buffer.subarray(occupiedEnd, Math.min(buffer.length, occupiedEnd + 16));
    assertDataDescriptor(entry, descriptor);
    occupiedEnd +=
      descriptor.length >= 16 && descriptor.readUInt32LE(0) === DATA_DESCRIPTOR_SIGNATURE ? 16 : 12;
  }
  if (dataEndLimit !== undefined && occupiedEnd > dataEndLimit) {
    throw new ZipIntegrityError(`zip_entry_overlaps_neighbor: ${entry.name}`);
  }
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

  // Each entry's payload (+ descriptor) must end before the NEXT entry's
  // local header — and the last one before the central directory.
  const centralDirectoryOffset = buffer.readUInt32LE(findEndOfCentralDirectory(buffer) + 16);
  const sortedOffsets = entries.map((e) => e.localHeaderOffset).sort((a, b) => a - b);
  const dataEndLimitFor = (entry: ZipEntry): number => {
    for (const offset of sortedOffsets) {
      if (offset > entry.localHeaderOffset) return offset;
    }
    return centralDirectoryOffset;
  };

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
      const data = readZipEntryData(buffer, entry, limits, dataEndLimitFor(entry));
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
