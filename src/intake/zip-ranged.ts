/**
 * Fast Intake — range-based ZIP reading for large archives.
 *
 * The buffer-based reader in `./zip.ts` requires the whole archive in memory,
 * which caps Studio archives at 16 MiB inside a memory-limited Worker. This
 * module reads the SAME untrusted-ZIP structure through a narrow random-access
 * byte source instead, so a 300 MiB archive is processed with bounded memory:
 *
 *   1. one bounded tail read locates the end-of-central-directory record;
 *   2. one bounded read materializes the central directory (size-capped);
 *   3. the complete entry set passes the IDENTICAL safety contract
 *      (`validateZipEntrySet`) before any entry is decompressed;
 *   4. each entry is then read individually — local header + compressed bytes
 *      only — inflated with an explicit output cap, and CRC-32 / declared-size
 *      verified, exactly like the buffer-based reader.
 *
 * ZIP64 is rejected: by the sentinel checks on every central-directory record
 * and the EOCD entry count, and by scanning the full EOCD tail window (the
 * only place a ZIP64 EOCD locator is structurally meaningful) for the locator
 * signature. Encrypted entries, unsupported compression, traversal names,
 * collisions, and expansion-ratio abuse are rejected by the shared entry-set
 * validation before any expansion.
 *
 * Everything here fails closed with the same deterministic ZipError family.
 */

import { inflateRawSync } from "node:zlib";

import {
  validateZipEntrySet,
  zipCrc32,
  ZipIntegrityError,
  ZipLimitError,
  ZipUnsupportedError,
  type ZipEntry,
  type ZipLimits,
} from "./zip";

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL_32 = 0xffffffff;
const ZIP64_SENTINEL_16 = 0xffff;

/** EOCD is 22 bytes plus an up-to-65535-byte trailing comment. */
const EOCD_MIN = 22;
const EOCD_TAIL_WINDOW = EOCD_MIN + 0xffff;

/**
 * Narrow random-access view of archive bytes. Implementations must return
 * exactly the requested range or throw; short reads are integrity failures.
 */
export interface ZipByteSource {
  /** Total archive size in bytes (already server-verified). */
  size(): number;
  /** Bytes [start, endExclusive). Caller guarantees bounded request sizes. */
  read(start: number, endExclusive: number): Promise<Buffer>;
}

/** Additional bounds that only exist for range-based reading. */
export interface RangedZipLimits extends ZipLimits {
  /** Cap on the materialized central directory (structure, not content). */
  maxCentralDirectoryBytes: number;
  /** Cap on one entry's COMPRESSED payload read (bounds a single read). */
  maxCompressedEntryBytes: number;
}

export interface RangedZipDirectory {
  entries: ZipEntry[];
  /** Absolute offset where the central directory starts (entry data ends). */
  centralDirectoryOffset: number;
}

async function readExact(source: ZipByteSource, start: number, endExclusive: number) {
  const data = await source.read(start, endExclusive);
  if (data.length !== endExclusive - start) {
    throw new ZipIntegrityError("zip_source_short_read");
  }
  return data;
}

/**
 * Locate and parse the end-of-central-directory record from one bounded tail
 * read, then materialize and parse the (size-capped) central directory, then
 * run the complete shared entry-set safety contract. Nothing is decompressed.
 */
export async function readZipDirectoryRanged(
  source: ZipByteSource,
  limits: RangedZipLimits,
  /** Containment root for path validation only — nothing is written. */
  virtualDest: string,
): Promise<RangedZipDirectory> {
  const archiveSize = source.size();
  if (archiveSize > limits.maxArchiveBytes) {
    throw new ZipLimitError(`zip_archive_too_large: ${archiveSize} > ${limits.maxArchiveBytes}`);
  }
  if (archiveSize < EOCD_MIN) throw new ZipIntegrityError("zip_truncated");

  const tailStart = Math.max(0, archiveSize - EOCD_TAIL_WINDOW);
  const tail = await readExact(source, tailStart, archiveSize);

  let eocdInTail = -1;
  for (let offset = tail.length - EOCD_MIN; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocdInTail = offset;
      break;
    }
  }
  if (eocdInTail < 0) throw new ZipIntegrityError("zip_end_of_central_directory_not_found");

  // A ZIP64 EOCD locator lives immediately before the EOCD; scanning the whole
  // tail window is the conservative superset of that position.
  for (let offset = 0; offset + 4 <= tail.length; offset += 1) {
    if (tail.readUInt32LE(offset) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
      throw new ZipUnsupportedError("zip64_unsupported");
    }
  }

  const diskEntries = tail.readUInt16LE(eocdInTail + 8);
  const totalEntries = tail.readUInt16LE(eocdInTail + 10);
  if (diskEntries !== totalEntries) throw new ZipUnsupportedError("zip_multi_disk_unsupported");
  if (totalEntries === ZIP64_SENTINEL_16) throw new ZipUnsupportedError("zip64_unsupported");
  if (totalEntries > limits.maxEntries) {
    throw new ZipLimitError(`zip_too_many_entries: ${totalEntries} > ${limits.maxEntries}`);
  }
  const cdSize = tail.readUInt32LE(eocdInTail + 12);
  const cdOffset = tail.readUInt32LE(eocdInTail + 16);
  if (cdSize === ZIP64_SENTINEL_32 || cdOffset === ZIP64_SENTINEL_32) {
    throw new ZipUnsupportedError("zip64_unsupported");
  }
  if (cdSize > limits.maxCentralDirectoryBytes) {
    throw new ZipLimitError(
      `zip_central_directory_too_large: ${cdSize} > ${limits.maxCentralDirectoryBytes}`,
    );
  }
  const eocdAbsolute = tailStart + eocdInTail;
  if (cdOffset + cdSize > eocdAbsolute) {
    throw new ZipIntegrityError("zip_central_directory_truncated");
  }

  const cd = await readExact(source, cdOffset, cdOffset + cdSize);
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > cd.length) throw new ZipIntegrityError("zip_central_directory_truncated");
    if (cd.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new ZipIntegrityError("zip_central_directory_corrupt");
    }
    const flags = cd.readUInt16LE(offset + 8);
    const method = cd.readUInt16LE(offset + 10);
    const crc = cd.readUInt32LE(offset + 16);
    const compressedSize = cd.readUInt32LE(offset + 20);
    const uncompressedSize = cd.readUInt32LE(offset + 24);
    const nameLength = cd.readUInt16LE(offset + 28);
    const extraLength = cd.readUInt16LE(offset + 30);
    const commentLength = cd.readUInt16LE(offset + 32);
    const externalAttributes = cd.readUInt32LE(offset + 38);
    const localHeaderOffset = cd.readUInt32LE(offset + 42);

    if (
      compressedSize === ZIP64_SENTINEL_32 ||
      uncompressedSize === ZIP64_SENTINEL_32 ||
      localHeaderOffset === ZIP64_SENTINEL_32
    ) {
      throw new ZipUnsupportedError("zip64_unsupported");
    }
    if (offset + 46 + nameLength > cd.length) {
      throw new ZipIntegrityError("zip_central_directory_truncated");
    }
    // Entry data must live strictly before the central directory.
    if (localHeaderOffset + 30 > cdOffset || compressedSize > cdOffset) {
      throw new ZipIntegrityError("zip_central_directory_corrupt");
    }

    const rawName = cd.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
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

  // The complete shared safety contract — identical to the buffer reader —
  // EXCEPT the benign per-entry/total size caps: hostile indicators
  // (traversal, collisions, encryption, symlinks, unsupported compression,
  // expansion-ratio abuse, ZIP64) stay archive-fatal here, while a merely
  // oversized entry (e.g. a large video) is the CALLER's per-entry decision —
  // it is skipped and retained privately without expanding, and never rejects
  // the rest of the archive. The caps are still enforced on every actual
  // read by readZipEntryDataRanged.
  validateZipEntrySet(
    archiveSize,
    entries,
    { ...limits, maxFileBytes: Number.MAX_SAFE_INTEGER, maxTotalBytes: Number.MAX_SAFE_INTEGER },
    virtualDest,
  );
  return { entries, centralDirectoryOffset: cdOffset };
}

/**
 * Read and verify ONE entry: bounded local-header read, bounded compressed
 * read, inflate with an explicit output cap, then declared-size and CRC-32
 * verification. Peak memory is one compressed payload plus one inflated entry.
 */
export async function readZipEntryDataRanged(
  source: ZipByteSource,
  directory: RangedZipDirectory,
  entry: ZipEntry,
  limits: RangedZipLimits,
): Promise<Buffer> {
  if (entry.isDirectory) return Buffer.alloc(0);
  if (entry.uncompressedSize > limits.maxFileBytes) {
    throw new ZipLimitError(`zip_file_too_large: ${entry.name}`);
  }
  if (entry.compressedSize > limits.maxCompressedEntryBytes) {
    throw new ZipLimitError(`zip_entry_compressed_too_large: ${entry.name}`);
  }
  const headerStart = entry.localHeaderOffset;
  const header = await readExact(source, headerStart, headerStart + 30);
  if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new ZipIntegrityError("zip_local_header_corrupt");
  }
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const dataStart = headerStart + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > directory.centralDirectoryOffset) {
    throw new ZipIntegrityError("zip_local_header_corrupt");
  }
  const compressed = await readExact(source, dataStart, dataEnd);

  let data: Buffer;
  if (entry.method === 0) {
    data = compressed;
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
  if (zipCrc32(data) !== entry.crc32) {
    throw new ZipIntegrityError(`zip_crc_mismatch: ${entry.name}`);
  }
  return data;
}
