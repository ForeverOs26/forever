/**
 * Browser upload manifest ↔ server-side fixture mirror: the REAL client
 * implementation (Web Crypto over a File) must produce exactly the ordered
 * per-part digests the node-side fixture computes over the same bytes; a
 * different file behind an identical name and size must produce a different
 * manifest no matter WHERE the bytes differ; and identity computation must
 * stay memory-bounded — the file is read strictly one fixed-size part at a
 * time, never as one whole-file ArrayBuffer.
 */

import { describe, expect, it } from "vitest";

import { computeUploadPartManifest } from "../components/archive-upload";
import { ARCHIVE_PART_BYTES } from "../studio-types";
import { manifestForParts, patternBytes, splitBuffer } from "./large-archive-fixtures";

const PART = ARCHIVE_PART_BYTES;

function asFile(buffer: Buffer, name: string): File {
  return new File([new Uint8Array(buffer)], name, { type: "application/zip" });
}

/** File that records every slice request and the max concurrent reads. */
class TrackingFile extends File {
  sliceSizes: number[] = [];
  private inFlight = 0;
  maxInFlight = 0;

  override slice(start?: number, end?: number, contentType?: string): Blob {
    const blob = super.slice(start, end, contentType);
    this.sliceSizes.push(blob.size);
    // jsdom Blobs may lack arrayBuffer (the client has a FileReader fallback);
    // define an instrumented one so the read path is observable either way.
    const original = typeof blob.arrayBuffer === "function" ? blob.arrayBuffer.bind(blob) : null;
    const readViaFileReader = () =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.readAsArrayBuffer(blob);
      });
    Object.defineProperty(blob, "arrayBuffer", {
      value: async () => {
        this.inFlight += 1;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        try {
          return await (original ? original() : readViaFileReader());
        } finally {
          this.inFlight -= 1;
        }
      },
    });
    return blob;
  }
}

describe("computeUploadPartManifest", () => {
  it("matches the node fixture mirror on a sub-part file", async () => {
    const content = patternBytes(64 * 1024, 9);
    const manifest = await computeUploadPartManifest(asFile(content, "small.zip"));
    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest).toEqual(manifestForParts(splitBuffer(content, PART)));
  });

  it("matches the node fixture mirror across multiple parts (incl. a short tail)", async () => {
    const content = patternBytes(20 * 1024 * 1024 + 4321, 21);
    const manifest = await computeUploadPartManifest(asFile(content, "large.zip"));
    expect(manifest).toHaveLength(Math.ceil(content.length / PART));
    expect(manifest).toEqual(manifestForParts(splitBuffer(content, PART)));
  });

  it("covers EVERY byte: same name and size differing at one interior byte manifest differently", async () => {
    const size = 20 * 1024 * 1024;
    const base = patternBytes(size, 1);
    const flipped = Buffer.from(base);
    // A byte the retired sampled fingerprint never read (outside its four
    // 256 KiB windows) — full-coverage identity still catches it.
    flipped[9 * 1024 * 1024 + 5] ^= 0xff;
    const one = await computeUploadPartManifest(asFile(base, "dossier.zip"));
    const two = await computeUploadPartManifest(asFile(flipped, "dossier.zip"));
    expect(one).not.toEqual(two);
    expect(two.filter((digest, index) => digest !== one[index])).toHaveLength(1);
  });

  it("stays memory-bounded: sequential single-part reads, never a whole-file buffer", async () => {
    const size = 3 * PART + 512 * 1024; // 4 parts incl. short tail
    const file = new TrackingFile([new Uint8Array(patternBytes(size, 5))], "big.zip", {
      type: "application/zip",
    });
    const manifest = await computeUploadPartManifest(file);
    expect(manifest).toHaveLength(4);
    // One slice per part, none larger than one part (never the whole file).
    expect(file.sliceSizes).toHaveLength(4);
    expect(Math.max(...file.sliceSizes)).toBeLessThanOrEqual(PART);
    expect(file.sliceSizes.reduce((sum, bytes) => sum + bytes, 0)).toBe(size);
    // Strictly sequential: at most ONE part's bytes are ever in flight.
    expect(file.maxInFlight).toBe(1);
  });
});
