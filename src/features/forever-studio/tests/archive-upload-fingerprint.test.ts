/**
 * Browser upload fingerprint ↔ server-side fixture mirror: the REAL client
 * implementation (Web Crypto over a File) must produce exactly the digest the
 * node-side fixture computes over the same bytes, for both the small
 * (full-content) and large (sampled) paths — and different content behind an
 * identical name and size must fingerprint differently.
 */

import { describe, expect, it } from "vitest";

import { computeUploadFingerprint } from "../components/archive-upload";
import { uploadFingerprintSampleRanges, UPLOAD_FINGERPRINT_SAMPLE_BYTES } from "../studio-types";
import { fingerprintForParts, patternBytes, splitBuffer } from "./large-archive-fixtures";

const PART = 8 * 1024 * 1024;

function asFile(buffer: Buffer, name: string): File {
  return new File([new Uint8Array(buffer)], name, { type: "application/zip" });
}

describe("computeUploadFingerprint", () => {
  it("matches the node fixture mirror on the small (full-content) path", async () => {
    const content = patternBytes(64 * 1024, 9);
    const browser = await computeUploadFingerprint(asFile(content, "small.zip"));
    expect(browser).toMatch(/^[0-9a-f]{64}$/);
    expect(browser).toBe(fingerprintForParts(splitBuffer(content, PART), content.length));
  });

  it("matches the node fixture mirror on the large (sampled) path", async () => {
    const content = patternBytes(20 * 1024 * 1024, 21);
    const browser = await computeUploadFingerprint(asFile(content, "large.zip"));
    expect(browser).toBe(fingerprintForParts(splitBuffer(content, PART), content.length));
  });

  it("distinguishes different content behind an identical filename and size", async () => {
    const size = 20 * 1024 * 1024;
    const one = await computeUploadFingerprint(asFile(patternBytes(size, 1), "dossier.zip"));
    const two = await computeUploadFingerprint(asFile(patternBytes(size, 2), "dossier.zip"));
    expect(one).not.toBe(two);
  });

  it("keeps the sampled read bounded (≤ 4 × 256 KiB regardless of file size)", () => {
    const ranges = uploadFingerprintSampleRanges(300 * 1024 * 1024);
    const sampled = ranges.reduce((sum, range) => sum + (range.end - range.start), 0);
    expect(ranges).toHaveLength(4);
    expect(sampled).toBe(4 * UPLOAD_FINGERPRINT_SAMPLE_BYTES);
  });
});
