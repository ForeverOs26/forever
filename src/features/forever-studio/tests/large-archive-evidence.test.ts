/**
 * Independent private evidence for large entries — the complete extraction
 * contract on one generated archive:
 *
 *   - a JPEG below 24 MiB publishes through Media Truth (claims-stripped);
 *   - a 64 MiB MP4 (STORE) and a 30 MiB PDF (DEFLATE) are streamed into
 *     fixed-size private evidence parts with real SHA-256, magic-byte class,
 *     CRC-verified reconstruction — and never become public;
 *   - a duplicate is skipped deterministically;
 *   - a corrupt oversized entry fails in isolation and leaves no evidence;
 *   - no single storage read or written object approaches the entry or
 *     archive size (bounded 8 MiB lanes, proven by instrumentation).
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { PRIVATE_SOURCE_BUCKET, PUBLIC_IMAGE_BUCKET } from "../server/extraction";
import { EVIDENCE_PART_BYTES } from "../server/large-archive";
import { processUploadJob } from "../server/service";
import { magicBytesFor, makeWorld, tinyMp4, OWNER } from "./fakes";
import {
  buildZipParts,
  patternBytes,
  startArchiveJob,
  uploadArchiveParts,
  type StreamedZipEntry,
} from "./large-archive-fixtures";

const PART = 8 * 1024 * 1024;
const MIB = 1024 * 1024;

function mp4Bytes(size: number): Buffer {
  const head = tinyMp4();
  return Buffer.concat([head, patternBytes(size - head.length, 42)]);
}

function pdfBytes(size: number): Buffer {
  const head = Buffer.from("%PDF-1.7\n");
  return Buffer.concat([head, patternBytes(size - head.length, 77)]);
}

describe("large-entry private evidence extraction", () => {
  it(
    "extracts MP4/PDF into private hashed evidence while the JPEG publishes and the corrupt entry is isolated",
    { timeout: 300_000 },
    async () => {
      const world = makeWorld();
      const jobId = await startArchiveJob(world, OWNER, {
        projectFacts: { name: "Evidence Manor" },
      });

      const MP4_SIZE = 64 * MIB; // between 50 and 100 MiB
      const PDF_SIZE = 30 * MIB; // document above the 24 MiB cap
      const mp4 = mp4Bytes(MP4_SIZE);
      const pdf = pdfBytes(PDF_SIZE);
      const entries: StreamedZipEntry[] = [
        { name: "photos/render.jpg", data: () => magicBytesFor("render.jpg") },
        { name: "video/walkthrough.mp4", data: () => mp4, method: 0 },
        { name: "docs/masterfile.pdf", data: () => pdf, method: 8 },
        { name: "photos/render-copy.jpg", data: () => magicBytesFor("render.jpg") },
        // Oversized AND corrupt: the streaming lane must fail it in
        // isolation and remove its partial evidence.
        {
          name: "video/damaged.mp4",
          data: () => mp4Bytes(26 * MIB),
          method: 0,
          corruptCrc: true,
        },
      ];
      const { parts, totalSize } = buildZipParts(entries, PART);
      await uploadArchiveParts(world, OWNER, jobId, "evidence.zip", parts, totalSize);

      // Instrumentation: no single private read and no single written object
      // may approach the entry/archive size.
      let largestRead = 0;
      const originalDownload = world.storage.downloadWithin.bind(world.storage);
      world.storage.downloadWithin = async (bucket, path, maxBytes) => {
        const result = await originalDownload(bucket, path, maxBytes);
        if (bucket === PRIVATE_SOURCE_BUCKET && result) {
          largestRead = Math.max(largestRead, result.length);
        }
        return result;
      };
      let largestWrite = 0;
      const originalUpload = world.storage.upload.bind(world.storage);
      world.storage.upload = async (bucket, path, data, contentType) => {
        largestWrite = Math.max(largestWrite, data.length);
        return originalUpload(bucket, path, data, contentType);
      };

      let result = await processUploadJob(world.deps, OWNER, jobId);
      let slices = 1;
      while (result.status === "processing") {
        result = await processUploadJob(world.deps, OWNER, jobId);
        slices += 1;
        if (slices > 60) throw new Error("did not settle within 60 slices");
      }
      expect(result.status).toBe("published");

      const rows = await world.deps.data.listJobArchiveEntries(jobId);
      const byName = new Map(rows.map((row) => [row.entry_name, row]));

      // 1. The JPEG published through Media Truth, claims stripped.
      expect(byName.get("photos/render.jpg")?.state).toBe("published_public");
      expect(world.executor.store.media).toHaveLength(1);
      const publicTruth = (
        world.executor.store.media[0].metadata as {
          studio?: { media_truth?: Record<string, unknown> };
        }
      ).studio?.media_truth;
      expect(publicTruth).toBeDefined();
      expect(publicTruth && "claims" in publicTruth).toBe(false);

      // 2. MP4 and PDF: independently extracted private evidence.
      for (const [name, source, expectedClass] of [
        ["video/walkthrough.mp4", mp4, "video"],
        ["docs/masterfile.pdf", pdf, "pdf"],
      ] as const) {
        const row = byName.get(name)!;
        expect(row.state).toBe("retained_private");
        expect(row.outcome_code).toBe("entry_over_size_limit");
        expect(row.observed_size).toBe(source.length);
        expect(row.media_class).toBe(expectedClass);
        expect(row.sha256).toBe(createHash("sha256").update(source).digest("hex"));
        const evidence = row.evidence!;
        expect(evidence.bucket).toBe(PRIVATE_SOURCE_BUCKET);
        expect(evidence.partSize).toBe(EVIDENCE_PART_BYTES);
        expect(evidence.partCount).toBe(Math.ceil(source.length / EVIDENCE_PART_BYTES));
        expect(evidence.totalSize).toBe(source.length);
        expect(evidence.crc32Verified).toBe(true);
        // Independently reconstructable from the stored evidence parts,
        // byte-for-byte — without touching the parent archive.
        const reconstructed: Buffer[] = [];
        for (const part of evidence.parts) {
          const key = `${PRIVATE_SOURCE_BUCKET}/${evidence.prefix}/${String(part.index).padStart(5, "0")}`;
          const stored = world.storage.objects.get(key)!;
          expect(stored.length).toBe(part.size);
          expect(createHash("sha256").update(stored).digest("hex")).toBe(part.sha256);
          reconstructed.push(stored);
        }
        expect(Buffer.concat(reconstructed).equals(source)).toBe(true);
      }

      // 3. Neither large entry became public: exactly one public object (the
      //    sanitized JPEG derivative) exists.
      expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(1);
      expect(byName.get("video/walkthrough.mp4")?.public_url).toBeNull();
      expect(byName.get("docs/masterfile.pdf")?.public_url).toBeNull();

      // 4. Duplicate skipped deterministically.
      expect(byName.get("photos/render-copy.jpg")?.state).toBe("skipped_duplicate");

      // 5. The corrupt oversized entry failed in ISOLATION: no evidence
      //    objects remain under its prefix and everything else completed.
      const damaged = byName.get("video/damaged.mp4")!;
      expect(damaged.state).toBe("failed");
      expect(damaged.outcome_code).toBe("entry_integrity_failed");
      expect(damaged.evidence).toBeNull();
      const damagedPrefix = `${PRIVATE_SOURCE_BUCKET}/jobs/${jobId}/evidence/${damaged.archive_id}/${String(damaged.entry_index).padStart(5, "0")}`;
      expect(
        [...world.storage.objects.keys()].filter((key) => key.startsWith(damagedPrefix)),
      ).toHaveLength(0);
      expect(rows.every((row) => row.state !== "pending")).toBe(true);

      // 6. Bounded lanes: nothing read or written in one piece approaches the
      //    64 MiB entry (let alone the archive).
      expect(largestRead).toBeLessThanOrEqual(PART);
      expect(largestWrite).toBeLessThanOrEqual(EVIDENCE_PART_BYTES);
      console.log(
        `[large-archive-evidence] archive=${(totalSize / MIB).toFixed(1)}MiB slices=${slices} ` +
          `largestRead=${(largestRead / MIB).toFixed(1)}MiB largestWrite=${(largestWrite / MIB).toFixed(1)}MiB`,
      );
    },
  );
});
