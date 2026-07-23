/**
 * Large-archive chunked upload contract: plan geometry and budgets, signed
 * part targets into PRIVATE staging, resume via re-plan, server-side stored-
 * byte verification before acceptance, and the authorization boundary.
 */

import { describe, expect, it } from "vitest";

import { StudioAccessError } from "../server/contracts";
import { PRIVATE_SOURCE_BUCKET } from "../server/extraction";
import { confirmJobArchiveUpload, planJobArchiveUpload, processUploadJob } from "../server/service";
import { ARCHIVE_PART_BYTES, LARGE_ARCHIVE_MAX_BYTES } from "../studio-types";
import { makeWorld, OWNER, PUBLISHER } from "./fakes";
import {
  buildZipParts,
  patternBytes,
  sha256HexSync,
  startArchiveJob,
  uploadArchiveParts,
} from "./large-archive-fixtures";

const PART = ARCHIVE_PART_BYTES;

function smallZipParts(entryCount = 3): { parts: Buffer[]; totalSize: number } {
  return buildZipParts(
    Array.from({ length: entryCount }, (_, index) => ({
      name: `docs/file-${index}.bin`,
      data: () => patternBytes(64 * 1024, index + 1),
    })),
    PART,
  );
}

/** ~12 MiB across two parts, to exercise real multi-part geometry. */
function multiPartZipParts(): { parts: Buffer[]; totalSize: number } {
  return buildZipParts(
    Array.from({ length: 3 }, (_, index) => ({
      name: `media/blob-${index}.bin`,
      data: () => patternBytes(4 * 1024 * 1024, index + 11),
    })),
    PART,
  );
}

describe("planJobArchiveUpload", () => {
  it("registers the part plan and issues one signed target per part into private staging", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const plan = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "dossier.zip",
      declaredSize: PART * 2 + 1234,
    });
    expect(plan.partSize).toBe(PART);
    expect(plan.partCount).toBe(3);
    expect(plan.presentParts).toEqual([]);
    expect(plan.parts).toHaveLength(3);
    for (const target of plan.parts) {
      expect(target.bucket).toBe(PRIVATE_SOURCE_BUCKET);
      expect(target.path).toContain(`jobs/${jobId}/parts/`);
    }
    const archive = await world.deps.data.getArchive(plan.archiveId);
    expect(archive?.status).toBe("planned");
    expect(archive?.part_count).toBe(3);
  });

  it("rejects non-ZIP names, oversized archives, archive-count and source budgets", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    await expect(
      planJobArchiveUpload(world.deps, OWNER, { jobId, fileName: "movie.mp4", declaredSize: PART }),
    ).rejects.toMatchObject({ code: "archive_not_zip" });
    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "big.zip",
        declaredSize: LARGE_ARCHIVE_MAX_BYTES + 1,
      }),
    ).rejects.toMatchObject({ code: "archive_too_large" });
    // Source budget: 1 GiB across the job's archives.
    for (let index = 0; index < 3; index += 1) {
      await planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: `part-${index}.zip`,
        declaredSize: LARGE_ARCHIVE_MAX_BYTES,
      });
    }
    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "over-budget.zip",
        declaredSize: LARGE_ARCHIVE_MAX_BYTES,
      }),
    ).rejects.toMatchObject({ code: "job_source_budget_exceeded" });
  });

  it("re-planning the same file resumes: present parts are reported, only missing parts get targets", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { parts, totalSize } = multiPartZipParts();
    const first = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "resume.zip",
      declaredSize: totalSize,
    });
    // Interrupted upload: only part 0 arrives.
    world.storage.put(first.parts[0].bucket, first.parts[0].path, Buffer.from(parts[0]));

    const resumed = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "resume.zip",
      declaredSize: totalSize,
    });
    expect(resumed.archiveId).toBe(first.archiveId);
    expect(resumed.presentParts).toEqual([0]);
    expect(resumed.parts.map((target) => target.index)).toEqual(
      first.parts.map((t) => t.index).filter((index) => index !== 0),
    );
  });

  it("denies another publisher's job and never allocates staging for it", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    await expect(
      planJobArchiveUpload(world.deps, PUBLISHER, {
        jobId,
        fileName: "x.zip",
        declaredSize: PART,
      }),
    ).rejects.toBeInstanceOf(StudioAccessError);
    expect((await world.deps.data.listJobArchives(jobId)).length).toBe(0);
  });

  it("refuses to attach archives to a published job", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER, {
      projectFacts: { name: "Done Project" },
    });
    const result = await processUploadJob(world.deps, OWNER, jobId);
    expect(result.status).toBe("published");
    await expect(
      planJobArchiveUpload(world.deps, OWNER, { jobId, fileName: "late.zip", declaredSize: PART }),
    ).rejects.toMatchObject({ code: "job_already_published" });
  });
});

describe("confirmJobArchiveUpload", () => {
  it("accepts only when every stored part exists with exactly the planned size", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { parts, totalSize } = smallZipParts();
    const plan = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "verify.zip",
      declaredSize: totalSize,
    });
    // Nothing uploaded yet: not accepted, every part reported missing.
    const early = await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId,
      archiveId: plan.archiveId,
      partSha256: parts.map((part) => sha256HexSync(part)),
    });
    expect(early.accepted).toBe(false);
    expect(early.missingParts.map((t) => t.index)).toEqual(parts.map((_, index) => index));

    for (const target of plan.parts) {
      world.storage.put(target.bucket, target.path, Buffer.from(parts[target.index]));
    }
    const accepted = await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId,
      archiveId: plan.archiveId,
      partSha256: parts.map((part) => sha256HexSync(part)),
    });
    expect(accepted.accepted).toBe(true);
    const archive = await world.deps.data.getArchive(plan.archiveId);
    expect(archive?.status).toBe("uploaded");
    expect(archive?.observed_size).toBe(totalSize);
    // Idempotent re-confirm.
    const again = await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId,
      archiveId: plan.archiveId,
      partSha256: parts.map((part) => sha256HexSync(part)),
    });
    expect(again.accepted).toBe(true);
  });

  it("removes wrong-sized stored parts and returns fresh targets for them", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { parts, totalSize } = multiPartZipParts();
    const plan = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "wrong-size.zip",
      declaredSize: totalSize,
    });
    for (const target of plan.parts) {
      world.storage.put(target.bucket, target.path, Buffer.from(parts[target.index]));
    }
    // Truncate part 1 in storage (size mismatch — never trusted).
    world.storage.put(
      plan.parts[1].bucket,
      plan.parts[1].path,
      Buffer.from(parts[1].subarray(0, parts[1].length - 7)),
    );
    const result = await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId,
      archiveId: plan.archiveId,
      partSha256: parts.map((part) => sha256HexSync(part)),
    });
    expect(result.accepted).toBe(false);
    expect(result.missingParts.map((target) => target.index)).toEqual([1]);
    // The wrong-sized object was removed so the fresh target can rewrite it.
    expect(await world.storage.statObject(plan.parts[1].bucket, plan.parts[1].path)).toBeNull();
  });

  it("rejects a malformed part manifest and foreign archives", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { totalSize } = smallZipParts();
    const plan = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "manifest.zip",
      declaredSize: totalSize,
    });
    await expect(
      confirmJobArchiveUpload(world.deps, OWNER, {
        jobId,
        archiveId: plan.archiveId,
        partSha256: ["not-a-hash"],
      }),
    ).rejects.toMatchObject({ code: "archive_part_manifest_invalid" });
    await expect(
      confirmJobArchiveUpload(world.deps, PUBLISHER, {
        jobId,
        archiveId: plan.archiveId,
        partSha256: [sha256HexSync(Buffer.from("x"))],
      }),
    ).rejects.toBeInstanceOf(StudioAccessError);
  });

  it("full simulated upload helper produces an accepted archive", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { parts, totalSize } = smallZipParts();
    const uploaded = await uploadArchiveParts(world, OWNER, jobId, "ok.zip", parts, totalSize);
    const archive = await world.deps.data.getArchive(uploaded.archiveId);
    expect(archive?.status).toBe("uploaded");
  });
});
