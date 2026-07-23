/**
 * Range-based ZIP reader — the same untrusted-archive contract as the buffer
 * reader, proven over a narrow random-access source that never holds the
 * whole archive: bounded tail/central-directory reads, full entry-set safety
 * validation before any expansion, per-entry CRC + size verification, and
 * fail-closed rejection of every hostile variant.
 */

import { describe, expect, it } from "vitest";

import {
  readZipDirectoryRanged,
  readZipEntryDataRanged,
  type RangedZipLimits,
  type ZipByteSource,
} from "../zip-ranged";
import {
  readZipEntries,
  ZipCollisionError,
  ZipIntegrityError,
  ZipLimitError,
  ZipTraversalError,
  ZipUnsupportedError,
} from "../zip";
import { makeZip, SYMLINK_EXTERNAL_ATTRS } from "./zip-writer";

const DEST = "/virtual-ranged-dest";

const LIMITS: RangedZipLimits = {
  maxArchiveBytes: 512 * 1024 * 1024,
  maxEntries: 2000,
  maxFileBytes: 24 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxPathLength: 512,
  maxCentralDirectoryBytes: 4 * 1024 * 1024,
  maxCompressedEntryBytes: 24 * 1024 * 1024,
};

/** Tracks every read so tests can prove access stays bounded and sparse. */
class TrackingSource implements ZipByteSource {
  reads: Array<{ start: number; end: number }> = [];
  constructor(private readonly buffer: Buffer) {}
  size(): number {
    return this.buffer.length;
  }
  async read(start: number, endExclusive: number): Promise<Buffer> {
    this.reads.push({ start, end: endExclusive });
    return Buffer.from(this.buffer.subarray(start, endExclusive));
  }
  bytesRead(): number {
    return this.reads.reduce((sum, r) => sum + (r.end - r.start), 0);
  }
  largestRead(): number {
    return this.reads.reduce((max, r) => Math.max(max, r.end - r.start), 0);
  }
}

describe("readZipDirectoryRanged", () => {
  it("reads the identical entry set the buffer reader produces", async () => {
    const zip = makeZip([
      { name: "photos/a.jpg", data: "jpeg-bytes-a", method: 8 },
      { name: "docs/facts.json", data: '{"name":{"value":"X"}}' },
      { name: "nested/dir/", directory: true },
      { name: "nested/dir/plan.pdf", data: "%PDF-1.4 plan", method: 8 },
    ]);
    const source = new TrackingSource(zip);
    const directory = await readZipDirectoryRanged(source, LIMITS, DEST);
    const reference = readZipEntries(zip);
    expect(directory.entries).toEqual(reference);
    expect(directory.centralDirectoryOffset).toBeGreaterThan(0);
  });

  it("reads only the tail and central directory — never the entry data", async () => {
    const big = Buffer.alloc(256 * 1024, 7);
    const zip = makeZip([
      { name: "a.bin", data: big },
      { name: "b.bin", data: big },
    ]);
    const source = new TrackingSource(zip);
    await readZipDirectoryRanged(source, LIMITS, DEST);
    // Tail window + central directory only: a fraction of the archive.
    expect(source.bytesRead()).toBeLessThan(zip.length / 2);
  });

  it("rejects traversal, symlink, encrypted, duplicate and bad-method sets fail-closed", async () => {
    const hostile: Array<[Parameters<typeof makeZip>[0], new (...args: never[]) => Error]> = [
      [[{ name: "../escape.txt", data: "x" }], ZipTraversalError],
      [[{ name: "C:evil.txt", data: "x" }], ZipTraversalError],
      [
        [{ name: "link", data: "target", externalAttributes: SYMLINK_EXTERNAL_ATTRS }],
        ZipUnsupportedError,
      ],
      [[{ name: "secret.txt", data: "x", flags: 0x1 }], ZipUnsupportedError],
      [
        [
          { name: "a.txt", data: "x" },
          { name: "a.txt", data: "y" },
        ],
        ZipCollisionError,
      ],
      [
        [
          { name: "A.txt", data: "x" },
          { name: "a.txt", data: "y" },
        ],
        ZipCollisionError,
      ],
      [
        [{ name: "weird.bin", data: "x", method: 99, rawStored: Buffer.from("x") }],
        ZipUnsupportedError,
      ],
    ];
    for (const [entries, errorType] of hostile) {
      const source = new TrackingSource(makeZip(entries));
      await expect(readZipDirectoryRanged(source, LIMITS, DEST)).rejects.toBeInstanceOf(errorType);
    }
  });

  it("rejects a ZIP64 locator signature in the tail window", async () => {
    const zip = makeZip([{ name: "a.txt", data: "x" }]);
    const locator = Buffer.alloc(4);
    locator.writeUInt32LE(0x07064b50, 0);
    const withLocator = Buffer.concat([
      zip.subarray(0, zip.length - 22),
      locator,
      zip.subarray(zip.length - 22),
    ]);
    const source = new TrackingSource(withLocator);
    await expect(readZipDirectoryRanged(source, LIMITS, DEST)).rejects.toBeInstanceOf(
      ZipUnsupportedError,
    );
  });

  it("rejects an oversized archive, entry count, and central directory", async () => {
    const zip = makeZip([{ name: "a.txt", data: "x" }]);
    await expect(
      readZipDirectoryRanged(new TrackingSource(zip), { ...LIMITS, maxArchiveBytes: 8 }, DEST),
    ).rejects.toBeInstanceOf(ZipLimitError);
    await expect(
      readZipDirectoryRanged(new TrackingSource(zip), { ...LIMITS, maxEntries: 0 }, DEST),
    ).rejects.toBeInstanceOf(ZipLimitError);
    await expect(
      readZipDirectoryRanged(
        new TrackingSource(zip),
        { ...LIMITS, maxCentralDirectoryBytes: 4 },
        DEST,
      ),
    ).rejects.toBeInstanceOf(ZipLimitError);
  });

  it("rejects expansion-ratio abuse fail-closed (hostile indicator)", async () => {
    // 2 MiB of zeros deflates to ~2 KiB — a ratio far beyond a tight limit.
    const bomb = Buffer.alloc(2 * 1024 * 1024, 0);
    const zip = makeZip([{ name: "bomb.bin", data: bomb, method: 8 }]);
    await expect(
      readZipDirectoryRanged(new TrackingSource(zip), { ...LIMITS, maxCompressionRatio: 10 }, DEST),
    ).rejects.toBeInstanceOf(ZipLimitError);
  });

  it("does NOT reject merely oversized entries at the set level (caller's per-entry decision)", async () => {
    const large = Buffer.alloc(64 * 1024, 3);
    const zip = makeZip([
      { name: "video.mp4", data: large },
      { name: "note.txt", data: "small" },
    ]);
    const directory = await readZipDirectoryRanged(
      new TrackingSource(zip),
      { ...LIMITS, maxFileBytes: 1024, maxCompressedEntryBytes: 1024 },
      DEST,
    );
    expect(directory.entries).toHaveLength(2);
  });

  it("fails closed on truncated and corrupt central structures", async () => {
    const zip = makeZip([{ name: "a.txt", data: "x" }]);
    const truncated = zip.subarray(0, zip.length - 4);
    await expect(
      readZipDirectoryRanged(new TrackingSource(Buffer.from(truncated)), LIMITS, DEST),
    ).rejects.toBeInstanceOf(ZipIntegrityError);
    const source = new TrackingSource(Buffer.from([1, 2, 3]));
    await expect(readZipDirectoryRanged(source, LIMITS, DEST)).rejects.toBeInstanceOf(
      ZipIntegrityError,
    );
  });
});

describe("readZipEntryDataRanged", () => {
  it("reads, inflates and verifies one entry with bounded sparse reads", async () => {
    const filler = Buffer.alloc(128 * 1024, 9);
    const zip = makeZip([
      { name: "filler-a.bin", data: filler },
      { name: "wanted.txt", data: "the actual content", method: 8 },
      { name: "filler-b.bin", data: filler },
    ]);
    const source = new TrackingSource(zip);
    const directory = await readZipDirectoryRanged(source, LIMITS, DEST);
    source.reads = [];
    const wanted = directory.entries.find((entry) => entry.name === "wanted.txt")!;
    const data = await readZipEntryDataRanged(source, directory, wanted, LIMITS);
    expect(data.toString("utf8")).toBe("the actual content");
    // Local header + compressed payload only — nothing near the filler size.
    expect(source.largestRead()).toBeLessThan(4096);
  });

  it("verifies CRC-32 and declared size per entry", async () => {
    const zip = makeZip([
      { name: "good.txt", data: "fine" },
      { name: "bad.txt", data: "corrupted", crcOverride: 0xdeadbeef },
    ]);
    const source = new TrackingSource(zip);
    const directory = await readZipDirectoryRanged(source, LIMITS, DEST);
    const good = directory.entries.find((entry) => entry.name === "good.txt")!;
    const bad = directory.entries.find((entry) => entry.name === "bad.txt")!;
    await expect(readZipEntryDataRanged(source, directory, bad, LIMITS)).rejects.toBeInstanceOf(
      ZipIntegrityError,
    );
    // One corrupt entry never affects another entry's readability.
    const data = await readZipEntryDataRanged(source, directory, good, LIMITS);
    expect(data.toString("utf8")).toBe("fine");
  });

  it("enforces the per-entry caps on every actual read", async () => {
    const zip = makeZip([{ name: "big.bin", data: Buffer.alloc(8 * 1024, 1) }]);
    const source = new TrackingSource(zip);
    const directory = await readZipDirectoryRanged(source, LIMITS, DEST);
    const entry = directory.entries[0];
    await expect(
      readZipEntryDataRanged(source, directory, entry, { ...LIMITS, maxFileBytes: 16 }),
    ).rejects.toBeInstanceOf(ZipLimitError);
    await expect(
      readZipEntryDataRanged(source, directory, entry, {
        ...LIMITS,
        maxCompressedEntryBytes: 16,
      }),
    ).rejects.toBeInstanceOf(ZipLimitError);
  });

  it("fails closed when a source cannot produce the requested range", async () => {
    const zip = makeZip([{ name: "a.txt", data: "content-here" }]);
    const directory = await readZipDirectoryRanged(new TrackingSource(zip), LIMITS, DEST);
    const short: ZipByteSource = {
      size: () => zip.length,
      read: async (start, end) => Buffer.from(zip.subarray(start, Math.max(start, end - 2))),
    };
    await expect(
      readZipEntryDataRanged(short, directory, directory.entries[0], LIMITS),
    ).rejects.toBeInstanceOf(ZipIntegrityError);
  });
});
