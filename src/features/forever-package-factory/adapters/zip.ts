/**
 * Package Factory — minimal, bounded ZIP reader for uploaded archives.
 *
 * An Owner-uploaded archive is one of the source kinds that must work with no
 * Drive, no Telegram and no network at all, so the Factory reads it directly
 * rather than requiring the Owner to extract it first.
 *
 * Deliberately small and defensive:
 *   - central directory only (no scanning for local headers, so a truncated or
 *     appended file cannot smuggle a second entry set);
 *   - store (0) and deflate (8) only, via node:zlib;
 *   - directory traversal (`..`, absolute, drive-letter, backslash) rejected;
 *   - per-entry and total inflated-size ceilings, so an archive cannot expand
 *     without bound.
 *
 * No temporary files, no subprocess, no network.
 */

import { inflateRawSync } from "node:zlib";

export const MAX_ARCHIVE_ENTRIES = 5000;
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

export interface ZipEntry {
  /** Normalized forward-slash path, guaranteed relative and traversal-free. */
  path: string;
  bytes: Buffer;
}

export class ZipError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ZipError";
    this.code = code;
  }
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/** Reject anything that could escape the extraction root. */
function safePath(raw: string): string | null {
  const normalized = raw.replace(/\\/g, "/");
  if (!normalized || normalized.endsWith("/")) return null; // directory entry
  if (normalized.startsWith("/")) return null;
  if (/^[A-Za-z]:/.test(normalized)) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === "")) return null;
  return normalized;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  // The comment field is at most 0xffff bytes, so the record starts within the
  // last 65557 bytes. Scan backwards for the signature.
  const start = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return -1;
}

/** Read every file entry of a ZIP archive held in memory. */
export function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) {
    throw new ZipError("archive_unreadable", "The archive has no ZIP central directory.");
  }
  const entryCount = buffer.readUInt16LE(eocd + 10);
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new ZipError(
      "archive_too_many_entries",
      `The archive declares ${entryCount} entries; the limit is ${MAX_ARCHIVE_ENTRIES}.`,
    );
  }
  let pointer = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let totalBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== CENTRAL_FILE_HEADER) {
      throw new ZipError("archive_unreadable", "The archive central directory is malformed.");
    }
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const uncompressedSize = buffer.readUInt32LE(pointer + 24);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const rawName = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString("utf8");
    pointer += 46 + nameLength + extraLength + commentLength;

    const path = safePath(rawName);
    if (!path) continue; // directory entry or an unsafe name: skipped, never written

    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new ZipError(
        "archive_entry_too_large",
        `"${path}" declares ${uncompressedSize} bytes; the per-entry limit is ${MAX_ENTRY_BYTES}.`,
      );
    }
    totalBytes += uncompressedSize;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new ZipError(
        "archive_too_large",
        `The archive expands past the ${MAX_TOTAL_BYTES}-byte ceiling.`,
      );
    }

    if (
      localOffset + 30 > buffer.length ||
      buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER
    ) {
      throw new ZipError("archive_unreadable", `"${path}" has no local header.`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    let bytes: Buffer;
    if (method === 0) {
      bytes = Buffer.from(data);
    } else if (method === 8) {
      try {
        bytes = inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
      } catch {
        throw new ZipError("archive_entry_unreadable", `"${path}" could not be decompressed.`);
      }
    } else {
      throw new ZipError(
        "archive_method_unsupported",
        `"${path}" uses compression method ${method}; only store and deflate are supported.`,
      );
    }
    entries.push({ path, bytes });
  }

  return entries;
}
