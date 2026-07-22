/**
 * FOREVER-STUDIO-001 — REAL ZIP safety-contract regressions.
 *
 * These tests drive the production extractStudioArchive (the exact code
 * deps.server.ts wires into Studio) with genuine ZIP bytes built in-test:
 * a genuine ZIP bomb, excessive declared total expansion, traversal,
 * encryption, collisions, ZIP64, entry-count limits, and mid-archive CRC
 * corruption. A rejected archive expands NOTHING (fail closed) and the
 * happy path streams entries one at a time with verified bytes.
 */

import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { extractStudioArchive, STUDIO_ZIP_LIMITS } from "../server/archive";

// ---------------------------------------------------------------------------
// Minimal real ZIP writer (local headers + central directory + EOCD)
// ---------------------------------------------------------------------------

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipSpec {
  name: string;
  data?: Buffer;
  /** 0 = stored, 8 = deflate. Defaults to stored. */
  method?: 0 | 8;
  /** Central-directory size lies (validation reads these, not the data). */
  declaredUncompressed?: number;
  declaredCompressed?: number;
  /** Override the recorded CRC (integrity regression). */
  crcOverride?: number;
  /** General-purpose flags (bit 0 = encrypted). */
  flags?: number;
  /** External attributes (upper 16 bits = unix mode; symlink regression). */
  externalAttributes?: number;
}

function buildZip(specs: ZipSpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const spec of specs) {
    const raw = spec.data ?? Buffer.alloc(0);
    const method = spec.method ?? 0;
    const stored = method === 8 ? deflateRawSync(raw) : raw;
    const crc = spec.crcOverride ?? crc32(raw);
    const name = Buffer.from(spec.name, "utf8");
    const compressedSize = spec.declaredCompressed ?? stored.length;
    const uncompressedSize = spec.declaredUncompressed ?? raw.length;
    const flags = spec.flags ?? 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(Buffer.concat([local, name, stored]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(spec.externalAttributes ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += 30 + name.length + stored.length;
  }
  const centralStart = offset;
  const centralBlob = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(specs.length, 8);
  eocd.writeUInt16LE(specs.length, 10);
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, centralBlob, eocd]);
}

async function collect(buffer: Buffer, fileName = "dossier.zip") {
  const entries: Array<{ name: string; data: Buffer }> = [];
  const result = await extractStudioArchive({ fileName, buffer }, async (entry) => {
    entries.push({ name: entry.name, data: Buffer.from(entry.data) });
  });
  return { entries, result };
}

describe("Studio ZIP safety contract (real archives)", () => {
  it("expands a valid archive one entry at a time with verified bytes", async () => {
    const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    const json = Buffer.from('{"unit_inventory":[]}');
    const zip = buildZip([
      { name: "photos/render.jpg", data: photo, method: 8 },
      { name: "price-list/price-list.json", data: json },
    ]);
    const { entries, result } = await collect(zip);
    expect(result.expanded).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(entries.map((e) => e.name)).toEqual(["photos/render.jpg", "price-list/price-list.json"]);
    expect(entries[0].data.equals(photo)).toBe(true);
    expect(entries[1].data.equals(json)).toBe(true);
  });

  it("rejects a GENUINE zip bomb (real deflate, extreme ratio) before expansion", async () => {
    // 8 MiB of zeros deflates to a few KiB — a real ratio in the thousands.
    const zeros = Buffer.alloc(8 * 1024 * 1024, 0);
    const zip = buildZip([{ name: "bomb.bin", data: zeros, method: 8 }]);
    expect(zip.length).toBeLessThan(64 * 1024); // it really is tiny on disk
    const { entries, result } = await collect(zip);
    expect(result.expanded).toBe(false);
    expect(entries).toHaveLength(0); // fail closed: nothing expanded
    expect(result.warnings.some((w) => w.code === "archive_rejected_unsafe")).toBe(true);
  });

  it("rejects excessive TOTAL declared expansion before touching any data", async () => {
    // 11 entries × 50 MiB declared = 550 MiB > the 500 MiB Studio budget.
    const specs: ZipSpec[] = Array.from({ length: 9 }, (_, i) => ({
      name: `part-${i}.bin`,
      data: Buffer.from("x"),
      declaredUncompressed: STUDIO_ZIP_LIMITS.maxFileBytes,
      declaredCompressed: STUDIO_ZIP_LIMITS.maxFileBytes,
    }));
    const { entries, result } = await collect(buildZip(specs));
    expect(result.expanded).toBe(false);
    expect(entries).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === "archive_rejected_unsafe")).toBe(true);
  });

  it("rejects a single over-limit declared entry", async () => {
    const big = STUDIO_ZIP_LIMITS.maxFileBytes + 1;
    const zip = buildZip([
      {
        name: "huge.bin",
        data: Buffer.from("x"),
        declaredUncompressed: big,
        declaredCompressed: big,
      },
    ]);
    const { entries, result } = await collect(zip);
    expect(result.expanded).toBe(false);
    expect(entries).toHaveLength(0);
  });

  it("rejects path traversal, absolute, and drive-letter names — expanding nothing", async () => {
    for (const name of ["../evil.jpg", "/etc/passwd", "C:\\evil.jpg", "a/../../b.jpg"]) {
      const { entries, result } = await collect(
        buildZip([
          { name: "ok.jpg", data: Buffer.from([0xff, 0xd8, 0xff]) },
          { name, data: Buffer.from("x") },
        ]),
      );
      expect(result.expanded, name).toBe(false);
      expect(entries, name).toHaveLength(0); // even the safe sibling stays unexpanded
    }
  });

  it("rejects encrypted entries", async () => {
    const { entries, result } = await collect(
      buildZip([{ name: "secret.jpg", data: Buffer.from("x"), flags: 0x1 }]),
    );
    expect(result.expanded).toBe(false);
    expect(entries).toHaveLength(0);
  });

  it("rejects symlink entries", async () => {
    const { entries, result } = await collect(
      buildZip([
        { name: "link.jpg", data: Buffer.from("x"), externalAttributes: (0o120777 << 16) >>> 0 },
      ]),
    );
    expect(result.expanded).toBe(false);
    expect(entries).toHaveLength(0);
  });

  it("rejects duplicate and case-insensitive path collisions", async () => {
    const dup = await collect(
      buildZip([
        { name: "a.jpg", data: Buffer.from("1") },
        { name: "a.jpg", data: Buffer.from("2") },
      ]),
    );
    expect(dup.result.expanded).toBe(false);
    const caseCollision = await collect(
      buildZip([
        { name: "Photo.jpg", data: Buffer.from("1") },
        { name: "photo.jpg", data: Buffer.from("2") },
      ]),
    );
    expect(caseCollision.result.expanded).toBe(false);
  });

  it("rejects Windows reserved names and a ZIP64 locator", async () => {
    const reserved = await collect(buildZip([{ name: "con.jpg", data: Buffer.from("x") }]));
    expect(reserved.result.expanded).toBe(false);

    const locator = Buffer.alloc(4);
    locator.writeUInt32LE(0x07064b50, 0);
    const zip64 = Buffer.concat([locator, buildZip([{ name: "a.jpg", data: Buffer.from("x") }])]);
    const z = await collect(zip64);
    expect(z.result.expanded).toBe(false);
  });

  it("rejects more entries than the Studio budget", async () => {
    const specs: ZipSpec[] = Array.from({ length: STUDIO_ZIP_LIMITS.maxEntries + 1 }, (_, i) => ({
      name: `f${i}.bin`,
      data: Buffer.from("x"),
    }));
    const { entries, result } = await collect(buildZip(specs));
    expect(result.expanded).toBe(false);
    expect(entries).toHaveLength(0);
  });

  it("stops at a mid-archive CRC corruption without expanding further entries", async () => {
    const zip = buildZip([
      { name: "good.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0x00]) },
      { name: "corrupt.jpg", data: Buffer.from("payload"), crcOverride: 0xdeadbeef },
      { name: "after.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0x01]) },
    ]);
    const { entries, result } = await collect(zip);
    expect(result.expanded).toBe(false);
    expect(entries.map((e) => e.name)).toEqual(["good.jpg"]);
    expect(result.warnings.some((w) => w.code === "archive_entry_integrity_failed")).toBe(true);
  });

  it("retains a non-ZIP file unexpanded with a warning", async () => {
    const { entries, result } = await collect(Buffer.from("not a zip"), "dossier.rar");
    expect(result.expanded).toBe(false);
    expect(entries).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === "archive_format_unsupported")).toBe(true);
  });
});
