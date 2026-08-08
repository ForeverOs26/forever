/**
 * FOREVER-R2-BINDING-NATIVE-MULTIPART-ARCHIVE-001 — the acceptance tests for
 * reopening `Full Project Archive / Other Package` on the production Worker.
 *
 * The sibling suites cover the lane's mechanics on the S3 harness
 * (`r2-multipart.test.ts`) and the binding transport
 * (`r2-worker-binding-processing.test.ts`). THIS suite pins the properties the
 * reopening was asked for, and pins them on a WORKER, which is where the lane
 * was closed:
 *
 *   - a >150 MB archive is planned, resumed and completed part by part;
 *   - an interrupted upload resumes against what STORAGE holds, not what the
 *     browser claims, and re-issues only the missing parts;
 *   - completing twice creates no second job, archive or object;
 *   - a wrong-sized part is discarded rather than accepted;
 *   - the whole-archive SHA-256 is verified against the bytes actually stored.
 *
 * Nothing here contacts production, staging or real R2.
 */

import { describe, expect, it } from "vitest";

import {
  confirmJobArchiveUpload,
  planJobArchiveUpload,
  processUploadJob,
  startUploadJob,
} from "../server/service";
import { archiveStorageState } from "../server/storage/job-provider";
import { ARCHIVE_PART_BYTES, LARGE_ARCHIVE_MAX_BYTES } from "../studio-types";
import { buildZipParts, manifestForParts, sha256HexSync } from "./large-archive-fixtures";
import { assertLocalR2Endpoint } from "./local-r2";
import { withWorkerRuntime } from "./local-r2-binding";
import { magicBytesFor, makeWorld, OWNER, TEST_R2_BUCKETS, type FakeWorld } from "./fakes";

/** Production's shape: the R2 write provider on a Cloudflare Worker. */
function workerWorld(): FakeWorld {
  const world = makeWorld({ r2Runtime: "worker" });
  assertLocalR2Endpoint(world.r2.endpoint);
  world.flags.writeProvider = "r2";
  return world;
}

function onWorker<T>(world: FakeWorld, run: () => Promise<T>): Promise<T> {
  return withWorkerRuntime(world.workerR2.env, run);
}

async function startJob(world: FakeWorld, name: string): Promise<string> {
  const started = await onWorker(world, () =>
    startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name },
      files: [],
    }),
  );
  return started.jobId;
}

/** Split a buffer into the lane's fixed-size parts. */
function partsOf(archive: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  for (let start = 0; start < archive.length; start += ARCHIVE_PART_BYTES) {
    parts.push(archive.subarray(start, Math.min(archive.length, start + ARCHIVE_PART_BYTES)));
  }
  return parts.length ? parts : [Buffer.alloc(0)];
}

/** PUT one planned part through its own short-lived presigned target. */
async function putPart(
  world: FakeWorld,
  target: { index: number; transport?: { kind: string; url?: string; headers?: HeadersInit } },
  body: Buffer,
): Promise<string> {
  const transport = target.transport!;
  if (transport.kind !== "r2_presigned_put") throw new Error("expected an R2 presigned target");
  const response = await world.r2.fetchImpl(transport.url!, {
    method: "PUT",
    headers: transport.headers,
    body: new Uint8Array(body) as unknown as BodyInit,
  });
  expect(response.ok).toBe(true);
  return (response.headers.get("etag") ?? "").replace(/"/g, "");
}

const ARCHIVE_PREFIX = (jobId: string, archiveId: string) =>
  `${TEST_R2_BUCKETS.projectArchives}/studio/archives/${jobId}/${archiveId}/parts/`;

// ---------------------------------------------------------------------------
// A large archive, on the host the lane used to be closed on
// ---------------------------------------------------------------------------

describe("a >150 MB archive on a Worker", () => {
  /**
   * 160 MiB of real bytes would dominate this suite's runtime for no extra
   * proof: what makes a large archive large is its PART GEOMETRY, and every
   * per-part operation — target issue, listing, resume arithmetic, discard — is
   * driven by that geometry alone. So the geometry is real and the bytes are
   * written only for the parts a given assertion needs.
   */
  const DECLARED = 160 * 1024 * 1024;
  const EXPECTED_PARTS = Math.ceil(DECLARED / ARCHIVE_PART_BYTES);

  it("is well inside the supported ceiling, and plans one target per part", async () => {
    expect(DECLARED).toBeGreaterThan(150 * 1024 * 1024);
    expect(DECLARED).toBeLessThanOrEqual(LARGE_ARCHIVE_MAX_BYTES);

    const world = workerWorld();
    const jobId = await startJob(world, "Large Archive");
    const partSha256 = Array.from({ length: EXPECTED_PARTS }, (_, index) =>
      sha256HexSync(Buffer.from(`part-${index}`)),
    );

    const plan = await onWorker(world, () =>
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "coralina-package.zip",
        declaredSize: DECLARED,
        materialPurpose: "project_archive",
        partSha256,
      }),
    );

    expect(plan.partCount).toBe(EXPECTED_PARTS);
    expect(EXPECTED_PARTS).toBe(20);
    expect(plan.parts).toHaveLength(EXPECTED_PARTS);
    // Every part is addressed as its own object under the archive's prefix.
    expect(plan.parts.map((part) => part.path)).toEqual(
      Array.from(
        { length: EXPECTED_PARTS },
        (_, index) => `archives/${jobId}/${plan.archiveId}/parts/${String(index).padStart(5, "0")}`,
      ),
    );
    // Allocating 20 targets on a Worker made no server-side S3 request at all.
    expect(world.workerR2.serverFetchAttempts).toEqual([]);
    expect(world.r2.uploads.size).toBe(0);
  });

  it("resumes against STORAGE, re-issuing only the parts it does not hold", async () => {
    const world = workerWorld();
    const jobId = await startJob(world, "Interrupted Large Archive");
    const partSha256 = Array.from({ length: EXPECTED_PARTS }, (_, index) =>
      sha256HexSync(Buffer.from(`part-${index}`)),
    );
    const input = {
      jobId,
      fileName: "coralina-package.zip",
      declaredSize: DECLARED,
      materialPurpose: "project_archive" as const,
      partSha256,
    };

    const plan = await onWorker(world, () => planJobArchiveUpload(world.deps, OWNER, input));
    // The connection dropped after three parts.
    const arrived = [0, 1, 2];
    for (const index of arrived) {
      const target = plan.parts.find((part) => part.index === index)!;
      await putPart(world, target, Buffer.alloc(ARCHIVE_PART_BYTES, index + 1));
    }

    const replan = await onWorker(world, () => planJobArchiveUpload(world.deps, OWNER, input));

    // Same archive, and the answer came from the prefix listing.
    expect(replan.archiveId).toBe(plan.archiveId);
    expect(replan.presentParts).toEqual(arrived);
    expect(replan.parts.map((part) => part.index)).toEqual(
      Array.from({ length: EXPECTED_PARTS - arrived.length }, (_, i) => i + arrived.length),
    );
    expect(world.workerR2.callsFor("project_archives").some((c) => c.op === "list")).toBe(true);
    expect(world.workerR2.serverFetchAttempts).toEqual([]);
  });

  it("never lets the browser's claim add a part storage does not hold", async () => {
    const world = workerWorld();
    const jobId = await startJob(world, "Lying Client");
    const partSha256 = Array.from({ length: EXPECTED_PARTS }, (_, index) =>
      sha256HexSync(Buffer.from(`part-${index}`)),
    );
    const plan = await onWorker(world, () =>
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "coralina-package.zip",
        declaredSize: DECLARED,
        materialPurpose: "project_archive",
        partSha256,
      }),
    );
    // Only ONE part was really uploaded.
    await putPart(world, plan.parts[0], Buffer.alloc(ARCHIVE_PART_BYTES, 1));

    // The browser claims a receipt for every part anyway.
    const confirmed = await onWorker(world, () =>
      confirmJobArchiveUpload(world.deps, OWNER, {
        jobId,
        archiveId: plan.archiveId,
        partSha256,
        partEtags: Array.from({ length: EXPECTED_PARTS }, (_, index) => ({
          index,
          etag: "f".repeat(32),
        })),
      }),
    );

    expect(confirmed.accepted).toBe(false);
    // ALL twenty come back. The nineteen it never uploaded are absent from the
    // listing; part 0 exists but its claimed receipt disagrees with the one
    // storage actually issued, so it is refused rather than trusted — the
    // browser's word is cross-checked, never the source.
    expect(confirmed.missingParts.map((part) => part.index)).toEqual(
      Array.from({ length: EXPECTED_PARTS }, (_, i) => i),
    );
  });

  it("accepts a truthful receipt for the same part", async () => {
    const world = workerWorld();
    const jobId = await startJob(world, "Truthful Client");
    const partSha256 = Array.from({ length: EXPECTED_PARTS }, (_, index) =>
      sha256HexSync(Buffer.from(`part-${index}`)),
    );
    const plan = await onWorker(world, () =>
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "coralina-package.zip",
        declaredSize: DECLARED,
        materialPurpose: "project_archive",
        partSha256,
      }),
    );
    const etag = await putPart(world, plan.parts[0], Buffer.alloc(ARCHIVE_PART_BYTES, 1));

    const confirmed = await onWorker(world, () =>
      confirmJobArchiveUpload(world.deps, OWNER, {
        jobId,
        archiveId: plan.archiveId,
        partSha256,
        partEtags: [{ index: 0, etag }],
      }),
    );

    // Part 0 is NOT in the missing list: the receipt matched, so only the
    // nineteen genuinely absent parts are re-issued.
    expect(confirmed.missingParts.map((part) => part.index)).toEqual(
      Array.from({ length: EXPECTED_PARTS - 1 }, (_, i) => i + 1),
    );
  });
});

// ---------------------------------------------------------------------------
// Whole-archive integrity and idempotence, end to end on a Worker
// ---------------------------------------------------------------------------

describe("a complete archive on a Worker", () => {
  function zipOf(entries: Array<{ name: string; data: Buffer }>): Buffer {
    const built = buildZipParts(
      entries.map((entry) => ({ name: entry.name, data: () => entry.data })),
      ARCHIVE_PART_BYTES,
    );
    return Buffer.concat(built.parts);
  }

  async function uploadAndConfirm(world: FakeWorld, jobId: string, archive: Buffer) {
    const parts = partsOf(archive);
    const partSha256 = manifestForParts(parts);
    const plan = await onWorker(world, () =>
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "package.zip",
        declaredSize: archive.length,
        materialPurpose: "project_archive",
        partSha256,
      }),
    );
    const partEtags: Array<{ index: number; etag: string }> = [];
    for (const target of plan.parts) {
      partEtags.push({
        index: target.index,
        etag: await putPart(world, target, parts[target.index]),
      });
    }
    const confirmInput = { jobId, archiveId: plan.archiveId, partSha256, partEtags };
    const confirmed = await onWorker(world, () =>
      confirmJobArchiveUpload(world.deps, OWNER, confirmInput),
    );
    return { plan, confirmed, confirmInput };
  }

  it("verifies the whole-archive SHA-256 against the bytes actually stored", async () => {
    const world = workerWorld();
    const jobId = await startJob(world, "Verified Archive");
    const archive = zipOf([
      { name: "photos/one.jpg", data: magicBytesFor("one.jpg") },
      { name: "photos/two.jpg", data: magicBytesFor("two.jpg") },
    ]);
    const { plan, confirmed } = await uploadAndConfirm(world, jobId, archive);
    expect(confirmed.accepted).toBe(true);

    let result = await onWorker(world, () => processUploadJob(world.deps, OWNER, jobId));
    for (let round = 0; round < 12 && result.status === "processing"; round += 1) {
      result = await onWorker(world, () => processUploadJob(world.deps, OWNER, jobId));
    }
    expect(result.status).toBe("completed");

    const row = await world.deps.data.getArchive(plan.archiveId);
    expect(row!.status).toBe("completed");
    expect(row!.parts.every((part) => part.verified)).toBe(true);
    // The digest of the SUBMITTED bytes, recomputed from what R2 holds.
    expect(row!.archive_sha256).toBe(sha256HexSync(archive));
    // The original archive is retained privately, never in a public bucket.
    expect(world.r2.keys(TEST_R2_BUCKETS.projectArchives).length).toBeGreaterThan(0);
    expect(world.workerR2.serverFetchAttempts).toEqual([]);
  });

  it("is idempotent: confirming twice creates no second job, archive or object", async () => {
    const world = workerWorld();
    const jobId = await startJob(world, "Idempotent Confirm");
    const archive = zipOf([{ name: "photo.jpg", data: magicBytesFor("photo.jpg") }]);
    const { plan, confirmed, confirmInput } = await uploadAndConfirm(world, jobId, archive);
    expect(confirmed.accepted).toBe(true);

    const after = {
      jobs: world.data.jobs.size,
      archives: world.data.archives.size,
      objects: [...world.r2.objects.keys()].sort(),
      status: (await world.deps.data.getArchive(plan.archiveId))!.status,
    };

    // The response was lost; the browser retries the identical confirm twice.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const again = await onWorker(world, () =>
        confirmJobArchiveUpload(world.deps, OWNER, confirmInput),
      );
      expect(again.accepted).toBe(true);
      expect(again.missingParts).toEqual([]);
    }

    expect(world.data.jobs.size).toBe(after.jobs);
    expect(world.data.archives.size).toBe(after.archives);
    expect([...world.r2.objects.keys()].sort()).toEqual(after.objects);
    expect((await world.deps.data.getArchive(plan.archiveId))!.status).toBe(after.status);
  });

  it("discards a wrong-sized part instead of accepting it", async () => {
    const world = workerWorld();
    const jobId = await startJob(world, "Short Part");
    // Two parts, so part 0 has a FIXED expected size a short write violates.
    const archive = Buffer.concat([
      Buffer.alloc(ARCHIVE_PART_BYTES, 0x41),
      Buffer.alloc(1024, 0x42),
    ]);
    const parts = partsOf(archive);
    const partSha256 = manifestForParts(parts);
    const plan = await onWorker(world, () =>
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "package.zip",
        declaredSize: archive.length,
        materialPurpose: "project_archive",
        partSha256,
      }),
    );
    // Part 0 arrives truncated; part 1 is correct.
    await putPart(world, plan.parts[0], Buffer.alloc(ARCHIVE_PART_BYTES - 512, 0x41));
    await putPart(world, plan.parts[1], parts[1]);

    const prefix = ARCHIVE_PREFIX(jobId, plan.archiveId);
    expect(world.r2.objects.has(`${prefix}00000`)).toBe(true);

    const confirmed = await onWorker(world, () =>
      confirmJobArchiveUpload(world.deps, OWNER, { jobId, archiveId: plan.archiveId, partSha256 }),
    );

    expect(confirmed.accepted).toBe(false);
    expect(confirmed.missingParts.map((part) => part.index)).toEqual([0]);
    // The bad part object was really DELETED — on a parts lane a leftover would
    // otherwise keep being listed as accepted at the wrong size.
    expect(world.r2.objects.has(`${prefix}00000`)).toBe(false);
    // The good one was left alone.
    expect(world.r2.objects.has(`${prefix}00001`)).toBe(true);

    // Re-uploading the part correctly then completes the archive.
    await putPart(world, confirmed.missingParts[0], parts[0]);
    const retried = await onWorker(world, () =>
      confirmJobArchiveUpload(world.deps, OWNER, { jobId, archiveId: plan.archiveId, partSha256 }),
    );
    expect(retried.accepted).toBe(true);
    expect(archiveStorageState((await world.deps.data.getArchive(plan.archiveId))!).completed).toBe(
      true,
    );
  });
});
