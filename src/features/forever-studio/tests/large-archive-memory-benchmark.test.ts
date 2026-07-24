// @vitest-environment node
/**
 * PROCESSING-ONLY memory benchmark for the 300 MiB lane, designed to answer
 * the independent-audit question the in-suite test could not: how much memory
 * does the ENGINE need, excluding everything the measurement previously
 * conflated with it —
 *
 *   - synthetic fixture generation (streamed to DISK before the baseline);
 *   - archive construction buffers (dropped before the baseline, GC forced);
 *   - the in-memory fake Storage retaining every uploaded/extracted object as
 *     a resident JS Buffer (replaced by a DISK-backed storage whose objects
 *     live in files, exactly like remote object storage in production);
 *   - test-runner worker overhead (a forked child process; every figure is a
 *     DELTA from a post-setup, post-GC baseline, and absolute RSS is logged).
 *
 * Run via: node scripts/studio/run-memory-benchmark.mjs
 * (sets FOREVER_MEMORY_BENCHMARK=1 and NODE_OPTIONS=--expose-gc so baselines
 * are taken after a forced GC; without the flag this file is skipped).
 *
 * Phase attribution (sampled at every storage operation and entry
 * settlement):
 *   verify_parts       streamed SHA-256 of each stored part (hashObject)
 *   exact_archive_sha  whole-archive SHA-256 streamed across ordered parts
 *   central_directory  first indexing reads after byte_verified up to the
 *                      first settlement (tail + central directory + inventory)
 *   buffered_entries   entries ≤ 24 MiB (in-memory sanitization lane)
 *   streaming_entries  entries > 24 MiB (bounded streaming evidence lane)
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StudioObjectStat, StudioStorage } from "../server/contracts";
import { PRIVATE_SOURCE_BUCKET } from "../server/extraction";
import { LARGE_ARCHIVE_ZIP_LIMITS } from "../server/large-archive";
import { confirmJobArchiveUpload, planJobArchiveUpload, processUploadJob } from "../server/service";
import { magicBytesFor, makeWorld, tinyMp4, OWNER } from "./fakes";
import {
  buildZipPartsStreaming,
  patternBytes,
  startArchiveJob,
  type StreamedZipEntry,
} from "./large-archive-fixtures";

const PART = 8 * 1024 * 1024;
const MIB = 1024 * 1024;

/**
 * Disk-backed StudioStorage: objects are FILES, hashing streams in 64 KiB
 * chunks, and nothing stored is retained in the JS heap — the same shape as
 * remote object storage, so RSS measures the ENGINE, not the fake.
 */
class DiskStorage implements StudioStorage {
  private readonly index = new Map<string, string>();
  private tokens = 0;

  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  private key(bucket: string, path: string): string {
    return `${bucket}/${path}`;
  }

  private fileFor(key: string): string {
    return join(this.root, createHash("sha1").update(key).digest("hex"));
  }

  /** Simulates the browser's signed-URL part upload without a heap buffer. */
  putFile(bucket: string, path: string, sourceFile: string): void {
    const key = this.key(bucket, path);
    const file = this.fileFor(key);
    copyFileSync(sourceFile, file);
    this.index.set(key, file);
  }

  async createSignedUpload(): Promise<{ token: string }> {
    this.tokens += 1;
    return { token: `signed-${this.tokens}` };
  }

  async listNames(bucket: string, prefix: string): Promise<Set<string>> {
    const names = new Set<string>();
    const fullPrefix = `${bucket}/${prefix}/`;
    for (const key of this.index.keys()) {
      if (!key.startsWith(fullPrefix)) continue;
      const rest = key.slice(fullPrefix.length);
      names.add(rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : rest);
    }
    return names;
  }

  async listObjects(
    bucket: string,
    prefix: string,
  ): Promise<Array<{ name: string; size: number }>> {
    const objects: Array<{ name: string; size: number }> = [];
    const fullPrefix = `${bucket}/${prefix}/`;
    for (const [key, file] of this.index) {
      if (!key.startsWith(fullPrefix)) continue;
      const rest = key.slice(fullPrefix.length);
      if (rest.includes("/")) continue;
      objects.push({ name: rest, size: statSync(file).size });
    }
    return objects;
  }

  async statObject(bucket: string, path: string): Promise<StudioObjectStat | null> {
    const file = this.index.get(this.key(bucket, path));
    return file ? { size: statSync(file).size } : null;
  }

  async hashObject(bucket: string, path: string, headBytes: number) {
    const file = this.index.get(this.key(bucket, path));
    if (!file) return null;
    const fd = openSync(file, "r");
    try {
      const hash = createHash("sha256");
      const chunk = Buffer.alloc(64 * 1024);
      const headParts: Buffer[] = [];
      let headLength = 0;
      let size = 0;
      for (;;) {
        const read = readSync(fd, chunk, 0, chunk.length, null);
        if (read <= 0) break;
        const view = chunk.subarray(0, read);
        hash.update(view);
        size += read;
        if (headLength < headBytes) {
          const take = view.subarray(0, headBytes - headLength);
          headParts.push(Buffer.from(take));
          headLength += take.length;
        }
      }
      return { sha256: hash.digest("hex"), size, head: Buffer.concat(headParts) };
    } finally {
      closeSync(fd);
    }
  }

  async downloadWithin(bucket: string, path: string, maxBytes: number): Promise<Buffer | null> {
    const file = this.index.get(this.key(bucket, path));
    if (!file) return null;
    if (statSync(file).size > maxBytes) return null;
    return readFileSync(file);
  }

  async readObjectStream(
    bucket: string,
    path: string,
    onChunk: (chunk: Buffer) => void | Promise<void>,
  ): Promise<number | null> {
    const file = this.index.get(this.key(bucket, path));
    if (!file) return null;
    const fd = openSync(file, "r");
    try {
      const chunk = Buffer.alloc(64 * 1024);
      let size = 0;
      for (;;) {
        const read = readSync(fd, chunk, 0, chunk.length, null);
        if (read <= 0) break;
        size += read;
        await onChunk(chunk.subarray(0, read));
      }
      return size;
    } finally {
      closeSync(fd);
    }
  }

  async upload(bucket: string, path: string, data: Buffer, _contentType?: string): Promise<void> {
    const key = this.key(bucket, path);
    const file = this.fileFor(key);
    writeFileSync(file, data);
    this.index.set(key, file);
  }

  async remove(bucket: string, paths: string[]): Promise<void> {
    for (const path of paths) {
      const key = this.key(bucket, path);
      const file = this.index.get(key);
      if (file) {
        try {
          unlinkSync(file);
        } catch {
          // best effort — the index entry is authoritative for the fake
        }
        this.index.delete(key);
      }
    }
  }

  publicUrl(bucket: string, path: string): string {
    return `https://cdn.bench/${bucket}/${path}`;
  }
}

type Phase =
  | "setup"
  | "verify_parts"
  | "exact_archive_sha"
  | "central_directory"
  | "buffered_entries"
  | "streaming_entries";

describe.runIf(process.env.FOREVER_MEMORY_BENCHMARK === "1")(
  "large-archive processing-only memory benchmark (disk-backed storage, forced GC)",
  () => {
    it(
      "measures per-phase peak RSS of the actual processing path on a ~286 MiB archive",
      { timeout: 900_000 },
      async () => {
        const gc = (globalThis as { gc?: () => void }).gc;
        const root = mkdtempSync(join(tmpdir(), "forever-large-archive-bench-"));
        const fixtureDir = join(root, "fixture");
        mkdirSync(fixtureDir);
        try {
          // ---- Fixture: streamed straight to DISK, never accumulated -------
          const bigEntryCount = 24; // 24 × 8 MiB raw payloads
          const MP4_SIZE = 64 * MIB; // streaming evidence lane (STORE)
          const PDF_SIZE = 30 * MIB; // streaming evidence lane (DEFLATE)
          const entries: StreamedZipEntry[] = [
            {
              name: "docs/facts.json",
              data: () =>
                Buffer.from(
                  JSON.stringify({
                    name: {
                      value: "Benchmark Manor",
                      confidence: "high",
                      source_file: "facts.json",
                    },
                  }),
                ),
            },
            ...Array.from({ length: bigEntryCount }, (_, index) => ({
              name: `raw/survey-${String(index).padStart(3, "0")}.bin`,
              data: () => patternBytes(8 * MIB, index + 1),
            })),
            {
              name: "video/walkthrough.mp4",
              data: () => Buffer.concat([tinyMp4(), patternBytes(MP4_SIZE - tinyMp4().length, 42)]),
              method: 0,
            },
            {
              name: "docs/masterfile.pdf",
              data: () =>
                Buffer.concat([Buffer.from("%PDF-1.7\n"), patternBytes(PDF_SIZE - 9, 77)]),
              method: 8,
            },
            { name: "photos/hero.jpg", data: () => magicBytesFor("hero.jpg") },
            { name: "photos/pool.jpg", data: () => magicBytesFor("pool.jpg") },
          ];
          const partFile = (index: number) =>
            join(fixtureDir, `part-${String(index).padStart(5, "0")}`);
          const { partCount, totalSize, partSha256 } = buildZipPartsStreaming(
            entries,
            PART,
            (index, part) => writeFileSync(partFile(index), part),
          );
          expect(totalSize).toBeGreaterThan(280 * MIB);
          expect(totalSize).toBeLessThan(300 * MIB);

          // ---- World with DISK-backed storage ------------------------------
          const world = makeWorld();
          const storage = new DiskStorage(join(root, "storage"));
          (world.deps as { storage: StudioStorage }).storage = storage;
          const jobId = await startArchiveJob(world, OWNER, {
            projectFacts: { name: "Benchmark Manor" },
          });
          const plan = await planJobArchiveUpload(world.deps, OWNER, {
            jobId,
            fileName: "benchmark.zip",
            declaredSize: totalSize,
            partSha256,
          });
          expect(plan.partCount).toBe(partCount);
          for (const target of plan.parts) {
            storage.putFile(target.bucket, target.path, partFile(target.index));
          }
          const confirmed = await confirmJobArchiveUpload(world.deps, OWNER, {
            jobId,
            archiveId: plan.archiveId,
            partSha256,
          });
          expect(confirmed.accepted).toBe(true);

          // ---- Instrumentation ---------------------------------------------
          let phase: Phase = "setup";
          const phasePeak = new Map<Phase, number>();
          let overallPeak = 0;
          let windowPeak = 0; // reset at each settlement, attributed per lane
          const sample = () => {
            const rss = process.memoryUsage().rss;
            phasePeak.set(phase, Math.max(phasePeak.get(phase) ?? 0, rss));
            overallPeak = Math.max(overallPeak, rss);
            windowPeak = Math.max(windowPeak, rss);
            return rss;
          };
          let largestRead = 0;
          let largestWrite = 0;
          let sawFirstSettle = false;

          const originalHash = storage.hashObject.bind(storage);
          storage.hashObject = async (bucket, path, headBytes) => {
            if (bucket === PRIVATE_SOURCE_BUCKET && path.includes("/parts/")) {
              if (phase === "setup" || phase === "exact_archive_sha") phase = "verify_parts";
            }
            sample();
            const result = await originalHash(bucket, path, headBytes);
            sample();
            return result;
          };
          const originalStream = storage.readObjectStream.bind(storage);
          storage.readObjectStream = async (bucket, path, onChunk) => {
            // The only readObjectStream caller is the exact whole-archive
            // SHA-256 pass (verification itself hashes via hashObject).
            if (bucket === PRIVATE_SOURCE_BUCKET && path.includes("/parts/")) {
              phase = "exact_archive_sha";
            }
            sample();
            const result = await originalStream(bucket, path, onChunk);
            sample();
            return result;
          };
          const originalDownload = storage.downloadWithin.bind(storage);
          storage.downloadWithin = async (bucket, path, maxBytes) => {
            sample();
            const result = await originalDownload(bucket, path, maxBytes);
            if (result) largestRead = Math.max(largestRead, result.length);
            sample();
            return result;
          };
          const originalUpload = storage.upload.bind(storage);
          storage.upload = async (bucket, path, data, contentType) => {
            largestWrite = Math.max(largestWrite, data.length);
            sample();
            await originalUpload(bucket, path, data, contentType);
            sample();
          };

          const data = world.deps.data;
          const originalPatch = data.updateArchiveIfClaimed.bind(data);
          data.updateArchiveIfClaimed = async (job, token, archiveId, patch) => {
            const applied = await originalPatch(job, token, archiveId, patch);
            if (applied && patch.status === "byte_verified") phase = "central_directory";
            sample();
            return applied;
          };
          const originalSettle = data.settleArchiveEntryIfClaimed.bind(data);
          data.settleArchiveEntryIfClaimed = async (job, token, entryId, outcome) => {
            const row = world.data.archiveEntries.get(entryId);
            const lane: Phase =
              row && row.uncompressed_size > LARGE_ARCHIVE_ZIP_LIMITS.maxFileBytes
                ? "streaming_entries"
                : "buffered_entries";
            sample();
            const applied = await originalSettle(job, token, entryId, outcome);
            if (!sawFirstSettle) {
              // Everything between byte_verified and the FIRST settlement is
              // the central-directory/indexing window.
              phasePeak.set(
                "central_directory",
                Math.max(phasePeak.get("central_directory") ?? 0, windowPeak),
              );
              sawFirstSettle = true;
            } else {
              phasePeak.set(lane, Math.max(phasePeak.get(lane) ?? 0, windowPeak));
            }
            phase = lane;
            windowPeak = 0;
            sample();
            return applied;
          };

          // ---- Baseline AFTER setup, fixture on disk, GC forced ------------
          gc?.();
          const baselineRss = process.memoryUsage().rss;
          overallPeak = baselineRss;

          // ---- Drive the real processing path to completion ----------------
          // Between slices (claim released) a forced GC separates the LIVE
          // working set from collectible bounded-lane churn: a memory-
          // pressured runtime (the Workers isolate near its cap) reclaims the
          // churn; only the live set can ever cause a hard OOM.
          let maxInterSliceLive = 0;
          const sampleInterSliceLive = () => {
            gc?.();
            maxInterSliceLive = Math.max(maxInterSliceLive, process.memoryUsage().rss);
          };
          let slices = 0;
          let result = await processUploadJob(world.deps, OWNER, jobId);
          slices += 1;
          sampleInterSliceLive();
          while (result.status === "processing") {
            result = await processUploadJob(world.deps, OWNER, jobId);
            slices += 1;
            sampleInterSliceLive();
            if (slices > 80) throw new Error("did not settle within 80 slices");
          }
          expect(result.status).toBe("published");
          const rows = await world.deps.data.listJobArchiveEntries(jobId);
          expect(rows).toHaveLength(entries.length);
          expect(rows.every((row) => row.state !== "pending")).toBe(true);
          const largestBufferedEntry = rows
            .filter((row) => row.uncompressed_size <= LARGE_ARCHIVE_ZIP_LIMITS.maxFileBytes)
            .reduce((max, row) => Math.max(max, row.observed_size ?? 0), 0);

          gc?.();
          const finalRss = process.memoryUsage().rss;
          const growth = overallPeak - baselineRss;

          // Log the full measurement FIRST so a failed bound still reports.
          const mib = (bytes: number | undefined) =>
            bytes === undefined ? null : Number(((bytes - baselineRss) / MIB).toFixed(1));
          console.log(
            `[large-archive-benchmark] ${JSON.stringify({
              gcForced: Boolean(gc),
              archiveMiB: Number((totalSize / MIB).toFixed(1)),
              parts: partCount,
              entryCount: entries.length,
              slices,
              baselineRssMiB: Number((baselineRss / MIB).toFixed(1)),
              peakGrowthMiB: Number((growth / MIB).toFixed(1)),
              phaseGrowthMiB: {
                verify_parts: mib(phasePeak.get("verify_parts")),
                exact_archive_sha: mib(phasePeak.get("exact_archive_sha")),
                central_directory: mib(phasePeak.get("central_directory")),
                buffered_entries: mib(phasePeak.get("buffered_entries")),
                streaming_entries: mib(phasePeak.get("streaming_entries")),
              },
              largestReadMiB: Number((largestRead / MIB).toFixed(2)),
              largestWriteMiB: Number((largestWrite / MIB).toFixed(2)),
              largestBufferedEntryMiB: Number((largestBufferedEntry / MIB).toFixed(2)),
              maxInterSliceLiveGrowthMiB: Number(
                ((maxInterSliceLive - baselineRss) / MIB).toFixed(1),
              ),
              finalGrowthMiB: Number(((finalRss - baselineRss) / MIB).toFixed(1)),
            })}`,
          );

          // ---- Truthful bounds ---------------------------------------------
          // Storage-boundary I/O stays at one 8 MiB lane in both directions.
          expect(largestRead).toBeLessThanOrEqual(PART);
          expect(largestWrite).toBeLessThanOrEqual(PART);
          // Unconstrained-GC watermark: the archive-sized figure never
          // appears; the number is dominated by collectible bounded-lane
          // churn (see maxInterSliceLive / finalGrowth for the live set).
          expect(growth).toBeLessThan(112 * MIB);
          // The LIVE set (post-GC) stays a small fraction of the archive.
          expect(maxInterSliceLive - baselineRss).toBeLessThan(40 * MIB);
          // After completion the engine holds on to nothing archive-sized.
          expect(finalRss - baselineRss).toBeLessThan(48 * MIB);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
    );
  },
);
