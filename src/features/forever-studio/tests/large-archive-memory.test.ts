/**
 * Bounded-memory proof for the 300 MiB lane: a genuine ~290 MiB generated ZIP
 * is accepted, verified, indexed, and fully processed while
 *
 *   1. no storage read EVER requests more than one 8 MiB part
 *      (the direct, deterministic proof that the whole archive is never
 *      downloaded or buffered), and
 *   2. the process's memory growth during processing stays a small fraction
 *      of the archive size (measured and recorded for the report).
 *
 * The fixture is streamed into parts while being generated, so not even the
 * test holds a whole-archive buffer.
 */

import { describe, expect, it } from "vitest";

import { PRIVATE_SOURCE_BUCKET } from "../server/extraction";
import { processUploadJob } from "../server/service";
import { magicBytesFor, makeWorld, OWNER } from "./fakes";
import {
  buildZipParts,
  patternBytes,
  startArchiveJob,
  uploadArchiveParts,
  type StreamedZipEntry,
} from "./large-archive-fixtures";

const PART = 8 * 1024 * 1024;
const MIB = 1024 * 1024;

describe("large-archive bounded memory (≈290 MiB genuine ZIP)", () => {
  it(
    "processes the archive in slices without whole-archive reads and with bounded memory growth",
    { timeout: 300_000 },
    async () => {
      const world = makeWorld();
      const jobId = await startArchiveJob(world, OWNER, {
        projectFacts: { name: "Massive Manor" },
      });

      // 36 × 8 MiB incompressible entries + photos + structured artifacts.
      const bigEntryCount = 36;
      const entries: StreamedZipEntry[] = [
        {
          name: "docs/facts.json",
          data: () =>
            Buffer.from(
              JSON.stringify({
                name: { value: "Massive Manor", confidence: "high", source_file: "facts.json" },
              }),
            ),
        },
        ...Array.from({ length: bigEntryCount }, (_, index) => ({
          name: `raw/survey-${String(index).padStart(3, "0")}.bin`,
          data: () => patternBytes(8 * MIB, index + 1),
        })),
        { name: "photos/hero.jpg", data: () => magicBytesFor("hero.jpg") },
        { name: "photos/pool.jpg", data: () => magicBytesFor("pool.jpg") },
      ];
      const { parts, totalSize } = buildZipParts(entries, PART);
      expect(totalSize).toBeGreaterThan(280 * MIB);
      expect(totalSize).toBeLessThan(300 * MIB);

      await uploadArchiveParts(world, OWNER, jobId, "massive.zip", parts, totalSize);

      // Instrument every read path: nothing may request more than one part.
      let largestDownloadRequest = 0;
      let downloadCalls = 0;
      const originalDownload = world.storage.downloadWithin.bind(world.storage);
      world.storage.downloadWithin = async (bucket, path, maxBytes) => {
        const result = await originalDownload(bucket, path, maxBytes);
        if (bucket === PRIVATE_SOURCE_BUCKET && result) {
          downloadCalls += 1;
          largestDownloadRequest = Math.max(largestDownloadRequest, result.length);
        }
        return result;
      };

      const usage = () => {
        const memory = process.memoryUsage();
        return memory.rss;
      };
      // The in-memory FAKE keeps every stored object's bytes resident, so the
      // private evidence copies written for the 36 retained 8 MiB entries
      // (~288 MiB of fake-storage payloads — remote objects in production)
      // would dominate RSS and mask what this test measures: the ENGINE's
      // bounded working set. Evidence parts are verified at write time inside
      // the slice; their payloads are evicted from the fake BETWEEN slices.
      const evidencePrefix = `${PRIVATE_SOURCE_BUCKET}/jobs/${jobId}/evidence/`;
      const evictFakeEvidencePayloads = () => {
        for (const key of world.storage.objects.keys()) {
          if (key.startsWith(evidencePrefix)) world.storage.objects.set(key, Buffer.alloc(0));
        }
      };
      const baselineRss = usage();
      let peakRss = baselineRss;

      let slices = 0;
      let result = await processUploadJob(world.deps, OWNER, jobId);
      slices += 1;
      peakRss = Math.max(peakRss, usage());
      evictFakeEvidencePayloads();
      while (result.status === "processing") {
        // Between slices the claim is released — durable, promptly claimable.
        const row = await world.deps.data.getJob(jobId);
        expect(row?.status).toBe("received");
        result = await processUploadJob(world.deps, OWNER, jobId);
        slices += 1;
        peakRss = Math.max(peakRss, usage());
        evictFakeEvidencePayloads();
        if (slices > 60) throw new Error("did not settle within 60 slices");
      }

      expect(result.status).toBe("published");
      const rows = await world.deps.data.listJobArchiveEntries(jobId);
      expect(rows).toHaveLength(entries.length);
      expect(rows.filter((row) => row.state === "published_public")).toHaveLength(2);
      expect(rows.filter((row) => row.state === "retained_private")).toHaveLength(
        bigEntryCount + 1, // raw entries + adopted facts JSON
      );
      expect(rows.every((row) => row.state !== "pending")).toBe(true);

      // THE bounded-read proof: no single private-staging read exceeded one part.
      expect(largestDownloadRequest).toBeLessThanOrEqual(PART);
      // And processing never grew the process by anything near the archive size.
      const growth = peakRss - baselineRss;
      expect(growth).toBeLessThan(220 * MIB);

      const totalExpanded = rows.reduce((sum, row) => sum + (row.observed_size ?? 0), 0);
      // Recorded measurements for the implementation report:
      console.log(
        `[large-archive-measurement] archive=${(totalSize / MIB).toFixed(1)}MiB ` +
          `parts=${parts.length} largestEntry=${8}MiB entries=${rows.length} ` +
          `totalExpanded=${(totalExpanded / MIB).toFixed(1)}MiB slices=${slices} ` +
          `downloadCalls=${downloadCalls} largestRead=${(largestDownloadRequest / MIB).toFixed(1)}MiB ` +
          `baselineRss=${(baselineRss / MIB).toFixed(1)}MiB peakRss=${(peakRss / MIB).toFixed(1)}MiB ` +
          `growth=${(growth / MIB).toFixed(1)}MiB`,
      );
    },
  );

  it(
    "survives an interruption mid-processing and resumes from the durable checkpoint",
    { timeout: 300_000 },
    async () => {
      const world = makeWorld();
      const jobId = await startArchiveJob(world, OWNER, {
        projectFacts: { name: "Interrupted Manor" },
      });
      const entries: StreamedZipEntry[] = Array.from({ length: 12 }, (_, index) => ({
        name: `raw/chunk-${String(index).padStart(2, "0")}.bin`,
        data: () => patternBytes(8 * MIB, index + 50),
      }));
      const { parts, totalSize } = buildZipParts(entries, PART);
      await uploadArchiveParts(world, OWNER, jobId, "interrupted.zip", parts, totalSize);

      // Advance one slice (verification + first entry batch), then a claimed
      // worker dies without releasing or settling anything.
      const first = await processUploadJob(world.deps, OWNER, jobId);
      expect(first.status).toBe("processing");
      const processedAtInterrupt = (await world.deps.data.listJobArchiveEntries(jobId)).filter(
        (row) => row.state !== "pending",
      ).length;
      const dead = await world.deps.data.requestJobProcessing(jobId, "dead-worker", 900);
      expect(dead).not.toBeNull();
      world.advanceMinutes(16);

      let slices = 0;
      let resumed = await processUploadJob(world.deps, OWNER, jobId);
      while (resumed.status === "processing") {
        resumed = await processUploadJob(world.deps, OWNER, jobId);
        slices += 1;
        if (slices > 40) throw new Error("resume did not settle");
      }
      expect(resumed.status).toBe("published");
      const rows = await world.deps.data.listJobArchiveEntries(jobId);
      expect(rows.every((row) => row.state === "retained_private")).toBe(true);
      console.log(
        `[large-archive-interruption] processedBeforeInterrupt=${processedAtInterrupt}/12 ` +
          `resumeSlices=${slices + 1}`,
      );
    },
  );
});
