/**
 * Fast Intake — range-based ZIP reading for large archives.
 *
 * The buffer-based reader in `./zip.ts` requires the whole archive in memory,
 * which caps Studio archives at 16 MiB inside a memory-limited Worker. This
 * module reads the SAME untrusted-ZIP structure through a narrow random-access
 * byte source instead, so a 300 MiB archive is processed with bounded memory:
 *
 *   1. one bounded tail read locates the ONE structurally valid
 *      end-of-central-directory record (exact-EOF comment rule, single-disk,
 *      ambiguity rejected);
 *   2. one bounded read materializes the central directory (size-capped,
 *      flush against the EOCD, consumed exactly);
 *   3. the complete entry set passes the IDENTICAL safety contract
 *      (`validateZipEntrySet`, incl. pairwise-disjoint local spans) before
 *      any entry is decompressed;
 *   4. each entry is then read individually — its LOCAL header bound to the
 *      central record (exact name bytes, method, flags, encryption,
 *      data-descriptor semantics) before the payload, inflated with an
 *      explicit output cap, and CRC-32 / declared-size verified, exactly
 *      like the buffer-based reader.
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
  assertDataDescriptor,
  assertLocalHeaderBinding,
  validateZipEntrySet,
  ZIP_CRC32_SEED,
  ZIP_FLAG_DATA_DESCRIPTOR,
  zipCrc32,
  zipCrc32Finish,
  zipCrc32Update,
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
  /**
   * Every entry's local header offset in ascending order: the containment
   * fence for per-entry reads — an entry's payload (+ descriptor) must end
   * before the NEXT local header (or the central directory).
   */
  sortedLocalOffsets: number[];
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

  // A candidate EOCD is valid ONLY when its declared comment consumes exactly
  // the rest of the archive (offset + 22 + commentLength == EOF): fake
  // signatures inside comments or arbitrary trailing bytes fail this rule.
  // Genuine records must be single-disk, and more than one exact-EOF
  // candidate makes the archive structurally ambiguous — rejected outright.
  const eocdCandidates: number[] = [];
  for (let offset = tail.length - EOCD_MIN; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(offset + 20);
    if (tailStart + offset + EOCD_MIN + commentLength !== archiveSize) continue;
    if (tail.readUInt16LE(offset + 4) !== 0 || tail.readUInt16LE(offset + 6) !== 0) {
      throw new ZipUnsupportedError("zip_multi_disk_unsupported");
    }
    eocdCandidates.push(offset);
  }
  if (eocdCandidates.length === 0) {
    throw new ZipIntegrityError("zip_end_of_central_directory_not_found");
  }
  if (eocdCandidates.length > 1) {
    throw new ZipIntegrityError("zip_ambiguous_end_of_central_directory");
  }
  const eocdInTail = eocdCandidates[0];

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
  // The central directory must sit flush against the EOCD and consume
  // exactly its declared byte size — no gaps, no trailing structure.
  if (cdOffset + cdSize !== eocdAbsolute) {
    throw new ZipIntegrityError("zip_central_directory_bounds_invalid");
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
    const diskNumberStart = cd.readUInt16LE(offset + 34);
    const externalAttributes = cd.readUInt32LE(offset + 38);
    const localHeaderOffset = cd.readUInt32LE(offset + 42);

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
    if (offset + 46 + nameLength > cd.length) {
      throw new ZipIntegrityError("zip_central_directory_truncated");
    }
    // Entry data must live strictly before the central directory.
    if (localHeaderOffset + 30 > cdOffset || compressedSize > cdOffset) {
      throw new ZipIntegrityError("zip_central_directory_corrupt");
    }

    const rawNameBytes = cd.subarray(offset + 46, offset + 46 + nameLength);
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
    if (offset > cd.length) {
      throw new ZipIntegrityError("zip_central_directory_truncated");
    }
  }
  // Exactly the declared central-directory bytes must have been consumed.
  if (offset !== cd.length) {
    throw new ZipIntegrityError("zip_central_directory_size_mismatch");
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
  return {
    entries,
    centralDirectoryOffset: cdOffset,
    sortedLocalOffsets: entries.map((entry) => entry.localHeaderOffset).sort((a, b) => a - b),
  };
}

/**
 * Validate ONE entry's local header and locate its compressed payload span —
 * without reading the payload. The local record is BOUND to the central
 * entry before anything else: exact name bytes (a second bounded read),
 * method, relevant flags, encryption state, and CRC/sizes (or their
 * data-descriptor form when bit 3 is set, in which case the descriptor after
 * the data is verified against the central values). The entry's occupied
 * region must end before the NEXT entry's local header (or the central
 * directory) — central metadata is never trusted to describe bytes that
 * belong to a different local record.
 */
export async function locateZipEntryData(
  source: ZipByteSource,
  directory: RangedZipDirectory,
  entry: ZipEntry,
): Promise<{ dataStart: number; dataEnd: number }> {
  const headerStart = entry.localHeaderOffset;
  const header = await readExact(source, headerStart, headerStart + 30);
  if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new ZipIntegrityError("zip_local_header_corrupt");
  }
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const nameBytes =
    nameLength > 0
      ? await readExact(source, headerStart + 30, headerStart + 30 + nameLength)
      : Buffer.alloc(0);
  assertLocalHeaderBinding(entry, {
    flags: header.readUInt16LE(6),
    method: header.readUInt16LE(8),
    crc32: header.readUInt32LE(14),
    compressedSize: header.readUInt32LE(18),
    uncompressedSize: header.readUInt32LE(22),
    rawName: nameBytes.toString("latin1"),
  });

  const dataStart = headerStart + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  // Containment fence: this entry may not reach into the next entry's local
  // record or the central directory.
  let upperBound = directory.centralDirectoryOffset;
  for (const offset of directory.sortedLocalOffsets) {
    if (offset > headerStart) {
      upperBound = Math.min(upperBound, offset);
      break;
    }
  }
  if (dataEnd > upperBound) {
    throw new ZipIntegrityError(`zip_entry_overlaps_neighbor: ${entry.name}`);
  }
  if ((entry.flags & ZIP_FLAG_DATA_DESCRIPTOR) !== 0) {
    if (upperBound - dataEnd < 12) {
      throw new ZipIntegrityError(`zip_data_descriptor_mismatch: ${entry.name}`);
    }
    const descriptor = await readExact(source, dataEnd, Math.min(upperBound, dataEnd + 16));
    assertDataDescriptor(entry, descriptor);
  }
  return { dataStart, dataEnd };
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
  const { dataStart, dataEnd } = await locateZipEntryData(source, directory, entry);
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

/**
 * Stream ONE entry's uncompressed bytes through `onData` with bounded memory,
 * for entries too large to buffer whole: the compressed span is read in
 * `maxChunkBytes` pieces, STORE passes chunks straight through, DEFLATE runs
 * through a streaming raw inflater with backpressure, and the running output
 * is capped at the declared uncompressed size. After the last chunk the exact
 * size and CRC-32 of the FULL uncompressed stream are verified against the
 * central-directory record — the same fail-closed contract as the buffered
 * reader. Peak memory ≈ one compressed chunk + the inflater window + one
 * output chunk, independent of entry size.
 *
 * NOTE: `onData` receives bytes BEFORE final CRC/size verification completes;
 * a caller persisting them must discard its side effects when this throws.
 */
export async function streamZipEntryDataRanged(
  source: ZipByteSource,
  directory: RangedZipDirectory,
  entry: ZipEntry,
  options: { maxChunkBytes: number },
  onData: (chunk: Buffer) => Promise<void>,
): Promise<void> {
  if (entry.isDirectory) return;
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipUnsupportedError(`zip_unsupported_compression_method: ${entry.method}`);
  }
  const chunkBytes = Math.max(64 * 1024, options.maxChunkBytes);
  const { dataStart, dataEnd } = await locateZipEntryData(source, directory, entry);

  let produced = 0;
  let crcState = ZIP_CRC32_SEED;
  const consume = async (chunk: Buffer): Promise<void> => {
    if (chunk.length === 0) return;
    produced += chunk.length;
    if (produced > entry.uncompressedSize) {
      throw new ZipIntegrityError(`zip_size_mismatch: ${entry.name}`);
    }
    crcState = zipCrc32Update(crcState, chunk);
    await onData(chunk);
  };

  if (entry.method === 0) {
    for (let start = dataStart; start < dataEnd; start += chunkBytes) {
      const end = Math.min(dataEnd, start + chunkBytes);
      await consume(await readExact(source, start, end));
    }
  } else {
    const { createInflateRaw } = await import("node:zlib");
    const { Readable, Writable } = await import("node:stream");
    const { pipeline } = await import("node:stream/promises");
    // Distinguish errors raised by our own source reads and consumer (short
    // reads, the size cap, the caller's storage writes — propagated verbatim)
    // from zlib/stream failures (a corrupt DEFLATE stream — reported as the
    // entry's integrity failure).
    let consumerError: unknown;
    async function* compressedChunks(): AsyncGenerator<Buffer> {
      for (let start = dataStart; start < dataEnd; start += chunkBytes) {
        const end = Math.min(dataEnd, start + chunkBytes);
        try {
          yield await readExact(source, start, end);
        } catch (error) {
          consumerError ??= error;
          throw error;
        }
      }
    }
    try {
      await pipeline(
        Readable.from(compressedChunks()),
        createInflateRaw(),
        new Writable({
          highWaterMark: chunkBytes,
          write(chunk: Buffer, _encoding, callback) {
            consume(chunk).then(
              () => callback(),
              (error) => {
                consumerError ??= error;
                callback(error as Error);
              },
            );
          },
        }),
      );
    } catch (error) {
      if (consumerError !== undefined) throw consumerError;
      if (error instanceof ZipIntegrityError) throw error;
      throw new ZipIntegrityError(`zip_inflate_failed: ${entry.name}`);
    }
  }

  if (produced !== entry.uncompressedSize) {
    throw new ZipIntegrityError(`zip_size_mismatch: ${entry.name}`);
  }
  if (zipCrc32Finish(crcState) !== entry.crc32) {
    throw new ZipIntegrityError(`zip_crc_mismatch: ${entry.name}`);
  }
}
