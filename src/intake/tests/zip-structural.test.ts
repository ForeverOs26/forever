/**
 * Structural-binding adversaries for BOTH ZIP readers (buffered + ranged):
 *
 *   EOCD    — a candidate is accepted only when its declared comment consumes
 *             exactly the rest of the file; fake signatures inside comments,
 *             lying comment lengths, undeclared trailing bytes, multi-disk
 *             markers, and ambiguous duplicate candidates all reject; the
 *             central directory must sit flush against the EOCD and be
 *             consumed exactly.
 *
 *   LOCAL   — before any payload read, each entry's local header must agree
 *             with its central record: exact name bytes, method, relevant
 *             flags, encryption state, CRC/sizes (or zeroed fields plus a
 *             verified data descriptor when bit 3 is set), and the entry's
 *             occupied region must stay inside its own fence — overlapping
 *             or foreign-pointing records are unrepresentable.
 *
 * All malformed structures fail BEFORE any unsafe expansion.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_ZIP_LIMITS,
  findEndOfCentralDirectory,
  readZipEntries,
  readZipEntryData,
  validateZipEntrySet,
  ZipIntegrityError,
  ZipUnsupportedError,
} from "../zip";
import {
  readZipDirectoryRanged,
  readZipEntryDataRanged,
  streamZipEntryDataRanged,
  type RangedZipLimits,
  type ZipByteSource,
} from "../zip-ranged";
import { makeZip } from "./zip-writer";

const DEST = "/virtual-structural-dest";

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

class BufferSource implements ZipByteSource {
  constructor(private readonly buffer: Buffer) {}
  size(): number {
    return this.buffer.length;
  }
  async read(start: number, endExclusive: number): Promise<Buffer> {
    return Buffer.from(this.buffer.subarray(start, endExclusive));
  }
}

const ranged = (zip: Buffer) => readZipDirectoryRanged(new BufferSource(zip), LIMITS, DEST);

/** Read one named entry through BOTH readers; both must behave identically. */
async function readEntryBothWays(zip: Buffer, name: string): Promise<Buffer[]> {
  const directory = await ranged(zip);
  const rangedEntry = directory.entries.find((entry) => entry.name === name)!;
  const rangedData = await readZipEntryDataRanged(
    new BufferSource(zip),
    directory,
    rangedEntry,
    LIMITS,
  );
  const bufferedEntry = readZipEntries(zip).find((entry) => entry.name === name)!;
  const bufferedData = readZipEntryData(zip, bufferedEntry, DEFAULT_ZIP_LIMITS);
  return [rangedData, bufferedData];
}

describe("EOCD structural binding", () => {
  it("accepts a genuine archive with an ordinary comment", async () => {
    const zip = makeZip([{ name: "a.txt", data: "payload" }], { comment: "vendor export v7" });
    expect(readZipEntries(zip)).toHaveLength(1);
    const [a, b] = await readEntryBothWays(zip, "a.txt");
    expect(a.toString("utf8")).toBe("payload");
    expect(b.toString("utf8")).toBe("payload");
  });

  it("rejects a fake exact-EOF EOCD embedded in the comment as ambiguous", async () => {
    // Comment = a fully plausible EOCD image whose own comment length also
    // lands exactly on EOF → two structurally valid candidates.
    const commentLength = 40;
    const fake = Buffer.alloc(22);
    fake.writeUInt32LE(0x06054b50, 0);
    fake.writeUInt16LE(0, 4);
    fake.writeUInt16LE(0, 6);
    fake.writeUInt16LE(1, 8);
    fake.writeUInt16LE(1, 10);
    fake.writeUInt32LE(46, 12);
    fake.writeUInt32LE(0, 16);
    fake.writeUInt16LE(commentLength - 22, 20);
    const comment = Buffer.concat([fake, Buffer.alloc(commentLength - 22, 0x41)]);
    const zip = makeZip([{ name: "a.txt", data: "x" }], { comment });
    expect(() => findEndOfCentralDirectory(zip)).toThrow(/zip_ambiguous_end_of_central_directory/);
    await expect(ranged(zip)).rejects.toThrow(/zip_ambiguous_end_of_central_directory/);
  });

  it("rejects a fake EOCD signature in the comment that is NOT exact-EOF (real record wins)", async () => {
    // A bare signature inside the comment fails the exact-EOF rule, so only
    // the real record is a candidate — the archive stays readable.
    const sig = Buffer.alloc(4);
    sig.writeUInt32LE(0x06054b50, 0);
    const comment = Buffer.concat([Buffer.from("prefix-"), sig, Buffer.from("-suffix")]);
    const zip = makeZip([{ name: "a.txt", data: "still fine" }], { comment });
    const [a] = await readEntryBothWays(zip, "a.txt");
    expect(a.toString("utf8")).toBe("still fine");
  });

  it("rejects a wrong EOCD comment length (both directions)", async () => {
    for (const delta of [-2, +3]) {
      const zip = makeZip([{ name: "a.txt", data: "x" }], {
        comment: "hello",
        commentLengthOverride: 5 + delta,
      });
      expect(() => readZipEntries(zip)).toThrow(/zip_end_of_central_directory_not_found/);
      await expect(ranged(zip)).rejects.toThrow(/zip_end_of_central_directory_not_found/);
    }
  });

  it("rejects trailing bytes after the declared comment", async () => {
    const zip = makeZip([{ name: "a.txt", data: "x" }], {
      comment: "ok",
      trailingGarbage: Buffer.from([1, 2, 3, 4, 5]),
    });
    expect(() => readZipEntries(zip)).toThrow(/zip_end_of_central_directory_not_found/);
    await expect(ranged(zip)).rejects.toThrow(/zip_end_of_central_directory_not_found/);
  });

  it("rejects nonzero EOCD disk numbers (this-disk and cd-start-disk)", async () => {
    for (const options of [{ thisDiskNumber: 1 }, { cdDiskNumber: 1 }]) {
      const zip = makeZip([{ name: "a.txt", data: "x" }], options);
      expect(() => readZipEntries(zip)).toThrow(ZipUnsupportedError);
      await expect(ranged(zip)).rejects.toBeInstanceOf(ZipUnsupportedError);
    }
  });

  it("rejects entries-on-this-disk != total entries", async () => {
    const zip = makeZip([{ name: "a.txt", data: "x" }], { diskEntriesOverride: 2 });
    expect(() => readZipEntries(zip)).toThrow(/zip_multi_disk_unsupported/);
    await expect(ranged(zip)).rejects.toThrow(/zip_multi_disk_unsupported/);
  });

  it("rejects a nonzero per-entry disk-start field", async () => {
    const zip = makeZip([{ name: "a.txt", data: "x" }], { entryDiskStart: 1 });
    expect(() => readZipEntries(zip)).toThrow(/zip_multi_disk_unsupported/);
    await expect(ranged(zip)).rejects.toThrow(/zip_multi_disk_unsupported/);
  });

  it("rejects a central directory that is not flush against the EOCD", async () => {
    for (const options of [{ cdSizeDelta: 8 }, { cdSizeDelta: -8 }, { cdOffsetDelta: -8 }]) {
      const zip = makeZip([{ name: "a.txt", data: "x" }], options);
      expect(() => readZipEntries(zip)).toThrow(/zip_central_directory_bounds_invalid/);
      await expect(ranged(zip)).rejects.toThrow(/zip_central_directory_bounds_invalid/);
    }
  });

  it("rejects a central directory that does not consume exactly its declared size", async () => {
    // Insert 8 junk bytes between the last central record and the EOCD and
    // grow the declared cd size to match: flush holds, consumption fails.
    const base = makeZip([{ name: "a.txt", data: "x" }]);
    const eocdOffset = base.length - 22;
    const junk = Buffer.alloc(8, 0x5a);
    const zip = Buffer.concat([base.subarray(0, eocdOffset), junk, base.subarray(eocdOffset)]);
    zip.writeUInt32LE(base.readUInt32LE(eocdOffset + 12) + 8, zip.length - 22 + 12);
    expect(() => readZipEntries(zip)).toThrow(ZipIntegrityError);
    await expect(ranged(zip)).rejects.toBeInstanceOf(ZipIntegrityError);
  });
});

describe("local-header binding", () => {
  it("rejects a local filename that differs from the central record's exact bytes", async () => {
    const zip = makeZip([
      { name: "good.txt", data: "fine" },
      { name: "docs/real-name.txt", data: "content", localNameOverride: "docs/other-name.txt" },
    ]);
    const directory = await ranged(zip);
    const bad = directory.entries.find((entry) => entry.name === "docs/real-name.txt")!;
    await expect(
      readZipEntryDataRanged(new BufferSource(zip), directory, bad, LIMITS),
    ).rejects.toThrow(/zip_local_header_mismatch: name/);
    await expect(
      streamZipEntryDataRanged(
        new BufferSource(zip),
        directory,
        bad,
        { maxChunkBytes: 65536 },
        async () => {},
      ),
    ).rejects.toThrow(/zip_local_header_mismatch: name/);
    const bufferedBad = readZipEntries(zip).find((entry) => entry.name === "docs/real-name.txt")!;
    expect(() => readZipEntryData(zip, bufferedBad)).toThrow(/zip_local_header_mismatch: name/);
    // The mismatching entry never blocks a well-formed neighbour.
    const good = directory.entries.find((entry) => entry.name === "good.txt")!;
    const data = await readZipEntryDataRanged(new BufferSource(zip), directory, good, LIMITS);
    expect(data.toString("utf8")).toBe("fine");
  });

  it("rejects a local compression method that differs from the central record", async () => {
    const zip = makeZip([{ name: "a.bin", data: "stored-bytes", localMethodOverride: 8 }]);
    const directory = await ranged(zip);
    await expect(
      readZipEntryDataRanged(new BufferSource(zip), directory, directory.entries[0], LIMITS),
    ).rejects.toThrow(/zip_local_header_mismatch: method/);
    expect(() => readZipEntryData(zip, readZipEntries(zip)[0])).toThrow(
      /zip_local_header_mismatch: method/,
    );
  });

  it("rejects local general-purpose flags that differ on the relevant bits", async () => {
    const zip = makeZip([{ name: "a.bin", data: "x", localFlagsOverride: 0x8 }]);
    const directory = await ranged(zip);
    await expect(
      readZipEntryDataRanged(new BufferSource(zip), directory, directory.entries[0], LIMITS),
    ).rejects.toThrow(/zip_local_header_mismatch: flags/);
    expect(() => readZipEntryData(zip, readZipEntries(zip)[0])).toThrow(
      /zip_local_header_mismatch: flags/,
    );
  });

  it("rejects a locally-encrypted entry whose central record claims plaintext", async () => {
    const zip = makeZip([{ name: "a.bin", data: "x", localFlagsOverride: 0x1 }]);
    const directory = await ranged(zip);
    await expect(
      readZipEntryDataRanged(new BufferSource(zip), directory, directory.entries[0], LIMITS),
    ).rejects.toThrow(/zip_encrypted_entry_rejected/);
    expect(() => readZipEntryData(zip, readZipEntries(zip)[0])).toThrow(
      /zip_encrypted_entry_rejected/,
    );
  });

  it("rejects local CRC/size fields that differ from the central record (bit 3 clear)", async () => {
    for (const override of [
      { localCrcOverride: 0x1234 },
      { localCompressedOverride: 999 },
      { localUncompressedOverride: 999 },
    ]) {
      const zip = makeZip([{ name: "a.bin", data: "payload-bytes", ...override }]);
      const directory = await ranged(zip);
      await expect(
        readZipEntryDataRanged(new BufferSource(zip), directory, directory.entries[0], LIMITS),
      ).rejects.toThrow(/zip_local_header_mismatch: sizes/);
      expect(() => readZipEntryData(zip, readZipEntries(zip)[0])).toThrow(
        /zip_local_header_mismatch: sizes/,
      );
    }
  });

  it("rejects a local header whose extra field pushes the payload past the entry fence", async () => {
    const zip = makeZip([
      { name: "a.bin", data: "sixteen-byte-pay" },
      { name: "filler.bin", data: Buffer.alloc(4096, 7) },
    ]);
    // Binary surgery: grow a.bin's LOCAL extra-length field without moving
    // any bytes — its claimed payload now reaches into filler.bin's record.
    zip.writeUInt16LE(600, 28);
    const directory = await ranged(zip);
    const entryA = directory.entries.find((entry) => entry.name === "a.bin")!;
    await expect(
      readZipEntryDataRanged(new BufferSource(zip), directory, entryA, LIMITS),
    ).rejects.toThrow(/zip_entry_overlaps_neighbor/);
    const buffered = readZipEntries(zip);
    const bufferedA = buffered.find((entry) => entry.name === "a.bin")!;
    const fillerOffset = buffered.find((entry) => entry.name === "filler.bin")!.localHeaderOffset;
    expect(() => readZipEntryData(zip, bufferedA, DEFAULT_ZIP_LIMITS, fillerOffset)).toThrow(
      /zip_entry_overlaps_neighbor/,
    );
  });

  it("rejects a central record pointing into ANOTHER entry's local record", async () => {
    const zip = makeZip([
      { name: "a.bin", data: "aaaaaaaaaaaa" },
      { name: "b.bin", data: "bbbbbbbbbbbb", centralOffsetOverride: 0 },
    ]);
    // The overlap is unrepresentable at the entry-set level for BOTH readers.
    await expect(ranged(zip)).rejects.toThrow(/zip_overlapping_entries/);
    expect(() =>
      validateZipEntrySet(zip.length, readZipEntries(zip), DEFAULT_ZIP_LIMITS, DEST),
    ).toThrow(/zip_overlapping_entries/);
  });

  it("rejects overlapping local data ranges (one entry claiming another's bytes)", async () => {
    const zip = makeZip([
      { name: "a.bin", data: "aaaaaaaaaaaa", method: 8, centralCompressedOverride: 64 },
      { name: "b.bin", data: "bbbbbbbbbbbb" },
    ]);
    await expect(ranged(zip)).rejects.toThrow(/zip_overlapping_entries/);
    expect(() =>
      validateZipEntrySet(zip.length, readZipEntries(zip), DEFAULT_ZIP_LIMITS, DEST),
    ).toThrow(/zip_overlapping_entries/);
  });
});

describe("data-descriptor semantics (bit 3)", () => {
  it("reads a valid data-descriptor entry (with and without the signature)", async () => {
    for (const descriptor of [true, { omitSignature: true }] as const) {
      const zip = makeZip([
        { name: "d.bin", data: "descriptor-payload", method: 8, dataDescriptor: descriptor },
        { name: "tail.txt", data: "after" },
      ]);
      const [a, b] = await readEntryBothWays(zip, "d.bin");
      expect(a.toString("utf8")).toBe("descriptor-payload");
      expect(b.toString("utf8")).toBe("descriptor-payload");
      // Streaming lane too.
      const directory = await ranged(zip);
      const entry = directory.entries.find((candidate) => candidate.name === "d.bin")!;
      const chunks: Buffer[] = [];
      await streamZipEntryDataRanged(
        new BufferSource(zip),
        directory,
        entry,
        { maxChunkBytes: 65536 },
        async (chunk) => {
          chunks.push(Buffer.from(chunk));
        },
      );
      expect(Buffer.concat(chunks).toString("utf8")).toBe("descriptor-payload");
    }
  });

  it("rejects a data descriptor whose values contradict the central record", async () => {
    const zip = makeZip([
      { name: "d.bin", data: "descriptor-payload", method: 8, dataDescriptor: { corrupt: true } },
    ]);
    const directory = await ranged(zip);
    await expect(
      readZipEntryDataRanged(new BufferSource(zip), directory, directory.entries[0], LIMITS),
    ).rejects.toThrow(/zip_data_descriptor_mismatch/);
    expect(() => readZipEntryData(zip, readZipEntries(zip)[0])).toThrow(
      /zip_data_descriptor_mismatch/,
    );
  });

  it("rejects bit 3 with a MISSING descriptor", async () => {
    const zip = makeZip([
      { name: "d.bin", data: "descriptor-payload", method: 8, dataDescriptor: { omit: true } },
    ]);
    const directory = await ranged(zip);
    await expect(
      readZipEntryDataRanged(new BufferSource(zip), directory, directory.entries[0], LIMITS),
    ).rejects.toThrow(/zip_data_descriptor_mismatch/);
    expect(() => readZipEntryData(zip, readZipEntries(zip)[0])).toThrow(
      /zip_data_descriptor_mismatch/,
    );
  });

  it("rejects bit 3 whose local CRC/size fields are not zero", async () => {
    const zip = makeZip([
      {
        name: "d.bin",
        data: "descriptor-payload",
        method: 8,
        dataDescriptor: true,
        localCompressedOverride: 5,
      },
    ]);
    const directory = await ranged(zip);
    await expect(
      readZipEntryDataRanged(new BufferSource(zip), directory, directory.entries[0], LIMITS),
    ).rejects.toThrow(/zip_local_header_mismatch: descriptor_fields/);
    expect(() => readZipEntryData(zip, readZipEntries(zip)[0])).toThrow(
      /zip_local_header_mismatch: descriptor_fields/,
    );
  });
});
