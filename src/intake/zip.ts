/**
 * Fast Intake v1 — a minimal, dependency-free, deterministic ZIP reader.
 *
 * Built only on `node:zlib` (raw DEFLATE) and `node:fs`. It reads the central
 * directory as the authoritative entry list, supports STORED (0) and
 * DEFLATE (8) methods, and rejects path traversal BEFORE writing anything to
 * disk. Nested archives are never recursively unpacked in v1.
 *
 * A hand-written reader is deliberate: it needs no new supply-chain
 * dependency, behaves identically on every OS and in CI, and gives Fast Intake
 * full control over the traversal-rejection boundary.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export class ZipError extends Error {}
export class ZipTraversalError extends ZipError {
  constructor(public readonly entryName: string) {
    super(`zip_path_traversal_rejected: ${entryName}`);
    this.name = "ZipTraversalError";
  }
}

export interface ZipEntry {
  /** The raw name as stored, separators normalized to forward slash. */
  name: string;
  isDirectory: boolean;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  // The EOCD is at the end; scan backwards past a possible variable comment.
  const minSize = 22;
  if (buffer.length < minSize) throw new ZipError("zip_truncated");
  const earliest = Math.max(0, buffer.length - minSize - 0xffff);
  for (let offset = buffer.length - minSize; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new ZipError("zip_end_of_central_directory_not_found");
}

/** Enumerate entries from the central directory (authoritative). */
export function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new ZipError("zip_central_directory_corrupt");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const name = rawName.split("\\").join("/");
    entries.push({
      name,
      isDirectory: name.endsWith("/"),
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Decompress a single entry's bytes using its local header for the offset. */
export function readZipEntryData(buffer: Buffer, entry: ZipEntry): Buffer {
  if (entry.isDirectory) return Buffer.alloc(0);
  if (buffer.readUInt32LE(entry.localHeaderOffset) !== LOCAL_SIGNATURE) {
    throw new ZipError("zip_local_header_corrupt");
  }
  const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) {
    return Buffer.from(compressed);
  }
  if (entry.method === 8) {
    return inflateRawSync(compressed);
  }
  throw new ZipError(`zip_unsupported_compression_method:${entry.method}`);
}

/**
 * Resolve an archive entry name to a safe path strictly inside `destDir`.
 * Rejects absolute paths, drive letters, and any `..` escape. Throws
 * `ZipTraversalError` (fail closed) before any write.
 */
export function safeJoinInside(destDir: string, entryName: string): string {
  const normalizedName = entryName.split("\\").join("/");
  if (
    normalizedName.startsWith("/") ||
    isAbsolute(normalizedName) ||
    /^[A-Za-z]:/.test(normalizedName)
  ) {
    throw new ZipTraversalError(entryName);
  }
  if (normalizedName.split("/").some((segment) => segment === "..")) {
    throw new ZipTraversalError(entryName);
  }
  const destRoot = resolve(destDir);
  const target = resolve(destRoot, normalizedName);
  const rel = relative(destRoot, target);
  if (rel === "" || rel === ".") return target;
  if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
    throw new ZipTraversalError(entryName);
  }
  return target;
}

export interface ExtractedZipFile {
  /** Path relative to destDir, forward-slash normalized. */
  relativePath: string;
  absolutePath: string;
  uncompressedSize: number;
}

/**
 * Extract every file entry into `destDir`, rejecting traversal before any
 * write. Directory entries create directories. Returns the written files.
 * Throws on the first unsafe entry; the caller is responsible for cleaning
 * the (gitignored) workspace afterward.
 */
export function extractZip(buffer: Buffer, destDir: string): ExtractedZipFile[] {
  const entries = readZipEntries(buffer);
  // Validate ALL names first so a traversal entry fails closed before writes.
  for (const entry of entries) safeJoinInside(destDir, entry.name);

  const written: ExtractedZipFile[] = [];
  mkdirSync(destDir, { recursive: true });
  for (const entry of entries) {
    const target = safeJoinInside(destDir, entry.name);
    if (entry.isDirectory) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    mkdirSync(join(target, ".."), { recursive: true });
    const data = readZipEntryData(buffer, entry);
    writeFileSync(target, data);
    written.push({
      relativePath: entry.name.replace(/\/+$/, ""),
      absolutePath: target,
      uncompressedSize: data.length,
    });
  }
  return written;
}
