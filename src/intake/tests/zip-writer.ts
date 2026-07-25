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
  /** LOCAL-header divergence overrides (structural-binding adversaries). */
  localNameOverride?: string;
  localMethodOverride?: number;
  localFlagsOverride?: number;
  localCrcOverride?: number;
  localCompressedOverride?: number;
  localUncompressedOverride?: number;
  /** Extra field emitted ONLY in the local header (shifts the data start). */
  localExtra?: Buffer;
  /** CENTRAL local-header-offset override (points at foreign bytes). */
  centralOffsetOverride?: number;
  /** CENTRAL compressed-size override (claims foreign bytes). */
  centralCompressedOverride?: number;
  /**
   * Emit bit-3 data-descriptor semantics: local CRC/sizes zero, real values
   * in a descriptor after the payload.
   */
  dataDescriptor?: boolean | { corrupt?: boolean; omitSignature?: boolean; omit?: boolean };
}

export interface MakeZipOptions {
  /** Trailing archive comment (declared in the EOCD). */
  comment?: Buffer | string;
  /** Lie about the comment length in the EOCD record. */
  commentLengthOverride?: number;
  /** Bytes appended AFTER the declared comment (undeclared trailing data). */
  trailingGarbage?: Buffer;
  /** EOCD "number of this disk". */
  thisDiskNumber?: number;
  /** EOCD "disk where the central directory starts". */
  cdDiskNumber?: number;
  /** EOCD "entries on this disk" override. */
  diskEntriesOverride?: number;
  /** Per-entry central "disk number start" applied to every record. */
  entryDiskStart?: number;
  /** Added to the declared central-directory size in the EOCD. */
  cdSizeDelta?: number;
  /** Added to the declared central-directory offset in the EOCD. */
  cdOffsetDelta?: number;
  /** Bytes inserted between the last entry and the central directory. */
  gapBeforeCentral?: Buffer;
}

/** Build a ZIP archive Buffer from the given entries. */
export function makeZip(entries: ZipInputEntry[], options: MakeZipOptions = {}): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const isDir = Boolean(entry.directory) || entry.name.endsWith("/");
    const nameBuf = Buffer.from(entry.name, "utf8");
    const localNameBuf = Buffer.from(entry.localNameOverride ?? entry.name, "utf8");
    const raw = isDir ? Buffer.alloc(0) : Buffer.from(entry.data ?? "");
    const method = isDir ? 0 : (entry.method ?? 0);
    const descriptor = entry.dataDescriptor;
    const flags = (entry.flags ?? 0) | (descriptor ? 0x8 : 0);
    let stored: Buffer;
    if (entry.rawStored) stored = entry.rawStored;
    else if (method === 8) stored = deflateRawSync(raw);
    else stored = raw;
    const crc = entry.crcOverride ?? crc32(raw);
    const externalAttributes = entry.externalAttributes ?? (isDir ? 0x10 : 0);
    const localExtra = entry.localExtra ?? Buffer.alloc(0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.localFlagsOverride ?? flags, 6);
    local.writeUInt16LE(entry.localMethodOverride ?? method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // fixed date for determinism
    local.writeUInt32LE(entry.localCrcOverride ?? (descriptor ? 0 : crc), 14);
    local.writeUInt32LE(entry.localCompressedOverride ?? (descriptor ? 0 : stored.length), 18);
    local.writeUInt32LE(entry.localUncompressedOverride ?? (descriptor ? 0 : raw.length), 22);
    local.writeUInt16LE(localNameBuf.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    localChunks.push(local, localNameBuf, localExtra, stored);
    let localRecordLength = local.length + localNameBuf.length + localExtra.length + stored.length;

    if (descriptor && !(typeof descriptor === "object" && descriptor.omit)) {
      const opts = typeof descriptor === "object" ? descriptor : {};
      const withSignature = !opts.omitSignature;
      const desc = Buffer.alloc(withSignature ? 16 : 12);
      let at = 0;
      if (withSignature) {
        desc.writeUInt32LE(0x08074b50, 0);
        at = 4;
      }
      desc.writeUInt32LE(opts.corrupt ? (crc ^ 0xff) >>> 0 : crc, at);
      desc.writeUInt32LE(stored.length, at + 4);
      desc.writeUInt32LE(raw.length, at + 8);
      localChunks.push(desc);
      localRecordLength += desc.length;
    }

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.centralCompressedOverride ?? stored.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(options.entryDiskStart ?? 0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(externalAttributes >>> 0, 38);
    central.writeUInt32LE(entry.centralOffsetOverride ?? offset, 42);
    centralChunks.push(central, nameBuf);

    offset += localRecordLength;
  }

  const gap = options.gapBeforeCentral ?? Buffer.alloc(0);
  const centralDir = Buffer.concat(centralChunks);
  const localData = Buffer.concat(localChunks);
  const comment =
    typeof options.comment === "string"
      ? Buffer.from(options.comment, "utf8")
      : (options.comment ?? Buffer.alloc(0));
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.thisDiskNumber ?? 0, 4);
  eocd.writeUInt16LE(options.cdDiskNumber ?? 0, 6);
  eocd.writeUInt16LE(options.diskEntriesOverride ?? entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length + (options.cdSizeDelta ?? 0), 12);
  eocd.writeUInt32LE(localData.length + gap.length + (options.cdOffsetDelta ?? 0), 16);
  eocd.writeUInt16LE(options.commentLengthOverride ?? comment.length, 20);

  return Buffer.concat([
    localData,
    gap,
    centralDir,
    eocd,
    comment,
    options.trailingGarbage ?? Buffer.alloc(0),
  ]);
}

/** The Unix symlink external-attributes value (S_IFLNK << 16). */
export const SYMLINK_EXTERNAL_ATTRS = 0o120000 << 16;
