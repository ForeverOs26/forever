/**
 * FOREVER-R2-MEDIA-STORAGE-CUTOVER-001 — the resumable large-archive lane on R2.
 *
 * The Owner-facing contract is unchanged: fixed-size parts, a per-part SHA-256
 * manifest as the resume identity, storage acceptance that proves every part
 * exists at its planned size, and byte verification of the ACTUAL stored bytes
 * before anything expands. What changed underneath is the transport: ONE R2
 * multipart upload assembling ONE immutable object, instead of many permanent
 * part objects.
 *
 * Everything runs against the local in-process S3 harness.
 */

import { describe, expect, it } from "vitest";

import {
  confirmJobArchiveUpload,
  planJobArchiveUpload,
  processUploadJob,
  startUploadJob,
} from "../server/service";
import { archiveStorageState } from "../server/storage/job-provider";
import { ARCHIVE_PART_BYTES, type StudioMaterialPurpose } from "../studio-types";
import { buildZipParts } from "./large-archive-fixtures";
import { assertLocalR2Endpoint } from "./local-r2";
import { magicBytesFor, makeWorld, OWNER, TEST_R2_BUCKETS, type FakeWorld } from "./fakes";

async function sha256Hex(data: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(data).digest("hex");
}

function partsOf(archive: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  for (let start = 0; start < archive.length; start += ARCHIVE_PART_BYTES) {
    parts.push(archive.subarray(start, Math.min(archive.length, start + ARCHIVE_PART_BYTES)));
  }
  return parts.length ? parts : [Buffer.alloc(0)];
}

async function manifestOf(archive: Buffer): Promise<string[]> {
  return Promise.all(partsOf(archive).map((part) => sha256Hex(part)));
}

function r2World(): FakeWorld {
  const world = makeWorld();
  assertLocalR2Endpoint(world.r2.endpoint);
  world.flags.writeProvider = "r2";
  return world;
}

/**
 * A ZIP big enough to need several 8 MiB parts would make every test slow, so
 * the geometry is exercised with a small archive (one part) AND with a forced
 * multi-part archive built by padding the ZIP's trailing comment.
 */
function buildZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const built = buildZipParts(
    entries.map((entry) => ({ name: entry.name, data: () => entry.data })),
    ARCHIVE_PART_BYTES,
  );
  return Buffer.concat(built.parts);
}

function multiPartZip(entries: Array<{ name: string; data: Buffer }>, parts: number): Buffer {
  const base = buildZip(entries);
  const target = ARCHIVE_PART_BYTES * (parts - 1) + 1024;
  if (base.length >= target) return base;
  // A ZIP's end-of-central-directory comment is trailing bytes the reader
  // tolerates, which lets a fixture reach a chosen size without breaking the
  // archive contract under test.
  return Buffer.concat([base, Buffer.alloc(target - base.length, 0x20)]);
}

async function startArchiveJob(world: FakeWorld) {
  return startUploadJob(world.deps, OWNER, {
    workflow: "new_development",
    projectFacts: { name: "R2 Multipart" },
    files: [],
  });
}

interface UploadedPlan {
  archiveId: string;
  partSha256: string[];
  parts: Buffer[];
  receipts: Array<{ index: number; etag: string }>;
}

/** Plan, then upload the given part indexes through their presigned targets. */
async function planAndUpload(
  world: FakeWorld,
  jobId: string,
  archive: Buffer,
  materialPurpose: StudioMaterialPurpose = "project_archive",
  only?: number[],
): Promise<UploadedPlan> {
  const partSha256 = await manifestOf(archive);
  const parts = partsOf(archive);
  const plan = await planJobArchiveUpload(world.deps, OWNER, {
    jobId,
    fileName: "package.zip",
    declaredSize: archive.length,
    materialPurpose,
    partSha256,
  });
  const receipts: Array<{ index: number; etag: string }> = [];
  for (const target of plan.parts) {
    if (only && !only.includes(target.index)) continue;
    const transport = target.transport!;
    if (transport.kind !== "r2_presigned_put") throw new Error("expected an R2 transport");
    const response = await world.r2.fetchImpl(transport.url, {
      method: "PUT",
      headers: transport.headers,
      body: new Uint8Array(parts[target.index]) as unknown as BodyInit,
    });
    expect(response.ok).toBe(true);
    receipts.push({
      index: target.index,
      etag: (response.headers.get("etag") ?? "").replace(/"/g, ""),
    });
  }
  return { archiveId: plan.archiveId, partSha256, parts, receipts };
}

describe("multipart plan", () => {
  it("creates ONE multipart upload and stores its durable identity", async () => {
    const world = r2World();
    const job = await startArchiveJob(world);
    const archive = buildZip([{ name: "photo.jpg", data: magicBytesFor("photo.jpg") }]);
    const uploaded = await planAndUpload(world, job.jobId, archive);

    const row = await world.deps.data.getArchive(uploaded.archiveId);
    const state = archiveStorageState(row!);
    expect(state.provider).toBe("r2");
    expect(state.multipartUploadId).toMatch(/^local-upload-/);
    expect(state.objectKey).toBe(`archives/${job.jobId}/${uploaded.archiveId}/archive.zip`);
    expect(state.completed).toBe(false);
    // The Owner's window survives on the durable row, not in a browser.
    expect(row!.extracted?.materialPurpose).toBe("project_archive");
    expect(row!.extracted?.purposeSource).toBe("owner_selected");
    // NO permanent part objects were created.
    expect(world.r2.keys(TEST_R2_BUCKETS.projectArchives)).toEqual([]);
    expect(world.r2.uploads.size).toBe(1);
  });

  it("accepts parts uploaded out of order and completes into one object", async () => {
    const world = r2World();
    const job = await startArchiveJob(world);
    const archive = multiPartZip([{ name: "photo.jpg", data: magicBytesFor("photo.jpg") }], 3);
    const partSha256 = await manifestOf(archive);
    const parts = partsOf(archive);
    expect(parts.length).toBe(3);

    const plan = await planJobArchiveUpload(world.deps, OWNER, {
      jobId: job.jobId,
      fileName: "package.zip",
      declaredSize: archive.length,
      materialPurpose: "project_archive",
      partSha256,
    });
    const receipts: Array<{ index: number; etag: string }> = [];
    // Deliberately reversed.
    for (const target of [...plan.parts].reverse()) {
      const transport = target.transport!;
      if (transport.kind !== "r2_presigned_put") throw new Error("expected an R2 transport");
      const response = await world.r2.fetchImpl(transport.url, {
        method: "PUT",
        headers: transport.headers,
        body: new Uint8Array(parts[target.index]) as unknown as BodyInit,
      });
      receipts.push({
        index: target.index,
        etag: (response.headers.get("etag") ?? "").replace(/"/g, ""),
      });
    }

    const confirmed = await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId: job.jobId,
      archiveId: plan.archiveId,
      partSha256,
      partEtags: receipts,
    });
    expect(confirmed.accepted).toBe(true);

    const key = `${TEST_R2_BUCKETS.projectArchives}/studio/archives/${job.jobId}/${plan.archiveId}/archive.zip`;
    const stored = world.r2.objects.get(key);
    expect(stored).toBeTruthy();
    // Completed object is immediately readable and byte-identical.
    expect(stored!.body.equals(archive)).toBe(true);
    expect(world.r2.uploads.size).toBe(0);
  });

  it("resume returns ONLY the missing parts and never re-keys stored ones", async () => {
    const world = r2World();
    const job = await startArchiveJob(world);
    const archive = multiPartZip([{ name: "photo.jpg", data: magicBytesFor("photo.jpg") }], 3);
    const first = await planAndUpload(world, job.jobId, archive, "project_archive", [0]);

    // The browser died; a fresh plan with the SAME manifest resumes.
    const replanned = await planJobArchiveUpload(world.deps, OWNER, {
      jobId: job.jobId,
      fileName: "package.zip",
      declaredSize: archive.length,
      materialPurpose: "project_archive",
      partSha256: first.partSha256,
    });
    expect(replanned.archiveId).toBe(first.archiveId);
    expect(replanned.presentParts).toEqual([0]);
    expect(replanned.parts.map((part) => part.index)).toEqual([1, 2]);
  });

  it("refuses completion while a part is missing", async () => {
    const world = r2World();
    const job = await startArchiveJob(world);
    const archive = multiPartZip([{ name: "photo.jpg", data: magicBytesFor("photo.jpg") }], 3);
    const uploaded = await planAndUpload(world, job.jobId, archive, "project_archive", [0, 1]);

    const confirmed = await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId: job.jobId,
      archiveId: uploaded.archiveId,
      partSha256: uploaded.partSha256,
      partEtags: uploaded.receipts,
    });
    expect(confirmed.accepted).toBe(false);
    expect(confirmed.missingParts.map((part) => part.index)).toEqual([2]);
    // Nothing was assembled.
    expect(world.r2.keys(TEST_R2_BUCKETS.projectArchives)).toEqual([]);
  });

  it("refuses a part whose claimed ETag disagrees with what storage holds", async () => {
    const world = r2World();
    const job = await startArchiveJob(world);
    const archive = buildZip([{ name: "photo.jpg", data: magicBytesFor("photo.jpg") }]);
    const uploaded = await planAndUpload(world, job.jobId, archive);

    const confirmed = await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId: job.jobId,
      archiveId: uploaded.archiveId,
      partSha256: uploaded.partSha256,
      partEtags: [{ index: 0, etag: "0".repeat(32) }],
    });
    expect(confirmed.accepted).toBe(false);
    expect(confirmed.missingParts.map((part) => part.index)).toEqual([0]);
  });

  it("is idempotent: a repeated confirm after completion succeeds unchanged", async () => {
    const world = r2World();
    const job = await startArchiveJob(world);
    const archive = buildZip([{ name: "photo.jpg", data: magicBytesFor("photo.jpg") }]);
    const uploaded = await planAndUpload(world, job.jobId, archive);
    const input = {
      jobId: job.jobId,
      archiveId: uploaded.archiveId,
      partSha256: uploaded.partSha256,
      partEtags: uploaded.receipts,
    };
    const first = await confirmJobArchiveUpload(world.deps, OWNER, input);
    expect(first.accepted).toBe(true);
    const objectsAfterFirst = new Map(world.r2.objects);
    const second = await confirmJobArchiveUpload(world.deps, OWNER, input);
    expect(second.accepted).toBe(true);
    expect([...world.r2.objects.keys()]).toEqual([...objectsAfterFirst.keys()]);
  });

  it("refuses a confirm presenting a DIFFERENT manifest", async () => {
    const world = r2World();
    const job = await startArchiveJob(world);
    const archive = buildZip([{ name: "photo.jpg", data: magicBytesFor("photo.jpg") }]);
    const uploaded = await planAndUpload(world, job.jobId, archive);
    await expect(
      confirmJobArchiveUpload(world.deps, OWNER, {
        jobId: job.jobId,
        archiveId: uploaded.archiveId,
        partSha256: uploaded.partSha256.map(() => "a".repeat(64)),
        partEtags: uploaded.receipts,
      }),
    ).rejects.toMatchObject({ name: "archive_manifest_mismatch" });
  });
});

describe("a lost multipart upload restarts only the affected archive", () => {
  it("rejects that archive under its old identity and re-plans a fresh key", async () => {
    const world = r2World();
    const job = await startArchiveJob(world);
    const archive = multiPartZip([{ name: "photo.jpg", data: magicBytesFor("photo.jpg") }], 2);
    const uploaded = await planAndUpload(world, job.jobId, archive, "project_archive", [0]);
    const original = await world.deps.data.getArchive(uploaded.archiveId);
    const uploadId = archiveStorageState(original!).multipartUploadId!;

    // R2's platform expiry removes the abandoned upload.
    world.r2.expireUpload(uploadId);

    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId: job.jobId,
        fileName: "package.zip",
        declaredSize: archive.length,
        materialPurpose: "project_archive",
        partSha256: uploaded.partSha256,
      }),
    ).rejects.toMatchObject({ name: "archive_upload_expired" });

    // The affected archive is terminal and truthful; the JOB is untouched.
    const rejected = await world.deps.data.getArchive(uploaded.archiveId);
    expect(rejected!.status).toBe("rejected");
    expect(rejected!.error_code).toBe("archive_upload_expired");
    const job2 = await world.deps.data.getJob(job.jobId);
    expect(job2!.status).toBe("received");

    // Re-adding the same file plans a FRESH archive with a FRESH object key.
    const retry = await planAndUpload(world, job.jobId, archive);
    expect(retry.archiveId).not.toBe(uploaded.archiveId);
    const fresh = await world.deps.data.getArchive(retry.archiveId);
    expect(archiveStorageState(fresh!).objectKey).not.toBe(
      archiveStorageState(original!).objectKey,
    );
  });
});

describe("processing the completed archive", () => {
  it("byte-verifies logical parts from the assembled object and expands it", async () => {
    const world = r2World();
    const job = await startArchiveJob(world);
    const archive = buildZip([
      { name: "photos/one.jpg", data: magicBytesFor("one.jpg") },
      { name: "photos/two.jpg", data: magicBytesFor("two.jpg") },
    ]);
    const uploaded = await planAndUpload(world, job.jobId, archive);
    const confirmed = await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId: job.jobId,
      archiveId: uploaded.archiveId,
      partSha256: uploaded.partSha256,
      partEtags: uploaded.receipts,
    });
    expect(confirmed.accepted).toBe(true);

    let result = await processUploadJob(world.deps, OWNER, job.jobId);
    for (let round = 0; round < 12 && result.status === "processing"; round += 1) {
      result = await processUploadJob(world.deps, OWNER, job.jobId);
    }
    expect(result.status).toBe("published");

    const row = await world.deps.data.getArchive(uploaded.archiveId);
    expect(row!.status).toBe("completed");
    expect(row!.parts.every((part) => part.verified)).toBe(true);
    expect(row!.archive_sha256).toBe(await sha256Hex(archive));
    // Entries published to the public bucket, originals never there.
    const publicKeys = world.r2.keys(TEST_R2_BUCKETS.publicMedia);
    expect(publicKeys.length).toBe(2);
    for (const key of publicKeys) expect(key.startsWith("media/")).toBe(true);
    // Zero Supabase Storage traffic for the whole archive lane.
    expect(world.storage.uploadCalls).toEqual([]);
    expect(world.storage.signedUploads).toEqual([]);
  });

  it("rejects an archive whose stored bytes disagree with the plan-time claims", async () => {
    const world = r2World();
    const job = await startArchiveJob(world);
    const archive = buildZip([{ name: "photo.jpg", data: magicBytesFor("photo.jpg") }]);
    const uploaded = await planAndUpload(world, job.jobId, archive);
    await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId: job.jobId,
      archiveId: uploaded.archiveId,
      partSha256: uploaded.partSha256,
      partEtags: uploaded.receipts,
    });

    // Corrupt the assembled object AFTER acceptance (models storage-side
    // damage). Verification hashes the actual bytes, so it must reject.
    const key = `${TEST_R2_BUCKETS.projectArchives}/studio/archives/${job.jobId}/${uploaded.archiveId}/archive.zip`;
    const stored = world.r2.objects.get(key)!;
    const damaged = Buffer.from(stored.body);
    damaged[damaged.length - 1] ^= 0xff;
    world.r2.objects.set(key, { ...stored, body: damaged });

    let result = await processUploadJob(world.deps, OWNER, job.jobId);
    for (let round = 0; round < 12 && result.status === "processing"; round += 1) {
      result = await processUploadJob(world.deps, OWNER, job.jobId);
    }
    const row = await world.deps.data.getArchive(uploaded.archiveId);
    expect(row!.status).toBe("rejected");
    expect(row!.error_code).toBe("archive_part_integrity_failed");
    // Nothing expanded, and the original stays privately retained.
    expect(world.r2.keys(TEST_R2_BUCKETS.publicMedia)).toEqual([]);
    expect(world.r2.objects.has(key)).toBe(true);
  });

  it("carries the Owner's non-archive window down to every entry", async () => {
    const world = r2World();
    const job = await startArchiveJob(world);
    const archive = buildZip([{ name: "anything.bin", data: magicBytesFor("plan.jpg") }]);
    const uploaded = await planAndUpload(world, job.jobId, archive, "floor_plan");
    await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId: job.jobId,
      archiveId: uploaded.archiveId,
      partSha256: uploaded.partSha256,
      partEtags: uploaded.receipts,
    });
    let result = await processUploadJob(world.deps, OWNER, job.jobId);
    for (let round = 0; round < 12 && result.status === "processing"; round += 1) {
      result = await processUploadJob(world.deps, OWNER, job.jobId);
    }
    const row = await world.deps.data.getArchive(uploaded.archiveId);
    // The window survived plan → part upload → completion → processing.
    expect(row!.extracted?.materialPurpose).toBe("floor_plan");
    const entries = await world.deps.data.listArchiveEntries(uploaded.archiveId);
    expect(entries).toHaveLength(1);
    // Inherited from the archive's window — NOT re-guessed from the entry name.
    expect(entries[0].category).toBe("floor-plan");
  });

  it("refuses to attach the same bytes to a different window", async () => {
    const world = r2World();
    const job = await startArchiveJob(world);
    const archive = buildZip([{ name: "photo.jpg", data: magicBytesFor("photo.jpg") }]);
    const uploaded = await planAndUpload(world, job.jobId, archive, "project_archive");
    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId: job.jobId,
        fileName: "package.zip",
        declaredSize: archive.length,
        materialPurpose: "floor_plan",
        partSha256: uploaded.partSha256,
      }),
    ).rejects.toMatchObject({ name: "archive_purpose_conflict" });
  });
});
