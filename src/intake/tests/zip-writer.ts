/**
 * Test-only minimal ZIP writer. Produces well-formed archives (correct CRC-32,
 * STORED or DEFLATE) so the production reader in `../zip.ts` is exercised for
 * real, plus deliberately malformed/hostile archives (traversal, encrypted,
 * unsupported method, corrupt CRC, symlink attributes) to prove rejection.
 * Not shipped in any runtime path — imported only by tests.
 */

import { deflateRawSync } from "node:zlib";

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipInputEntry {
  name: string;
  data?: Buffer | string;
  /** Compression method to record (0 stored, 8 deflate, other = unsupported). */
  method?: number;
  /** Force a directory entry (name will end with "/"). */
  directory?: boolean;
  /** General-purpose flags (bit 0 set = encrypted). */
  flags?: number;
  /** Override the stored CRC-32 (to simulate corruption). */
  crcOverride?: number;
  /** External file attributes (high 16 bits = Unix mode; 0xA000 = symlink). */
  externalAttributes?: number;
  /**
   * When set, these exact bytes are stored as the entry payload regardless of
   * `method` (used to emit an "unsupported method" entry with real bytes).
   */
  rawStored?: Buffer;
}

/** Build a ZIP archive Buffer from the given entries. */
export function makeZip(entries: ZipInputEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const isDir = Boolean(entry.directory) || entry.name.endsWith("/");
    const nameBuf = Buffer.from(entry.name, "utf8");
    const raw = isDir ? Buffer.alloc(0) : Buffer.from(entry.data ?? "");
    const method = isDir ? 0 : (entry.method ?? 0);
    const flags = entry.flags ?? 0;
    let stored: Buffer;
    if (entry.rawStored) stored = entry.rawStored;
    else if (method === 8) stored = deflateRawSync(raw);
    else stored = raw;
    const crc = entry.crcOverride ?? crc32(raw);
    const externalAttributes = entry.externalAttributes ?? (isDir ? 0x10 : 0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // fixed date for determinism
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, nameBuf, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(externalAttributes >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + stored.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const localData = Buffer.concat(localChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localData, centralDir, eocd]);
}

/** The Unix symlink external-attributes value (S_IFLNK << 16). */
export const SYMLINK_EXTERNAL_ATTRS = 0o120000 << 16;
