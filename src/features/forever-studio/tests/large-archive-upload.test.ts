/**
 * Large-archive chunked upload contract: plan geometry and budgets, signed
 * part targets into PRIVATE staging, fingerprint-keyed resume identity,
 * server-side stored-byte acceptance (existence + exact size — truthfully
 * NOT byte verification), and the authorization boundary.
 */

import { describe, expect, it } from "vitest";

import { StudioAccessError } from "../server/contracts";
import { PRIVATE_SOURCE_BUCKET } from "../server/extraction";
import { confirmJobArchiveUpload, planJobArchiveUpload, processUploadJob } from "../server/service";
import { ARCHIVE_PART_BYTES, LARGE_ARCHIVE_MAX_BYTES } from "../studio-types";
import { makeWorld, OWNER, PUBLISHER } from "./fakes";
import {
  buildZipParts,
  fingerprintForParts,
  patternBytes,
  sha256HexSync,
  startArchiveJob,
  storedPartKeys,
  uploadArchiveParts,
} from "./large-archive-fixtures";

const PART = ARCHIVE_PART_BYTES;
/** Well-formed fingerprint for validation-only plans that never upload. */
const ANY_FP = "0".repeat(63) + "1";

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
function multiPartZipParts(seedBase = 11): { parts: Buffer[]; totalSize: number } {
  return buildZipParts(
    Array.from({ length: 3 }, (_, index) => ({
      name: `media/blob-${index}.bin`,
      data: () => patternBytes(4 * 1024 * 1024, index + seedBase),
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
      uploadFingerprint: ANY_FP,
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
    expect(archive?.upload_fingerprint).toBe(ANY_FP);
    expect(archive?.archive_sha256).toBeNull();
  });

  it("rejects non-ZIP names, bad fingerprints, oversized archives, archive-count and source budgets", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "movie.mp4",
        declaredSize: PART,
        uploadFingerprint: ANY_FP,
      }),
    ).rejects.toMatchObject({ code: "archive_not_zip" });
    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "no-fp.zip",
        declaredSize: PART,
        uploadFingerprint: "not-a-digest",
      }),
    ).rejects.toMatchObject({ code: "archive_fingerprint_invalid" });
    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "big.zip",
        declaredSize: LARGE_ARCHIVE_MAX_BYTES + 1,
        uploadFingerprint: ANY_FP,
      }),
    ).rejects.toMatchObject({ code: "archive_too_large" });
    // Source budget: 1 GiB across the job's archives.
    for (let index = 0; index < 3; index += 1) {
      await planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: `part-${index}.zip`,
        declaredSize: LARGE_ARCHIVE_MAX_BYTES,
        uploadFingerprint: `${index}`.repeat(64).slice(0, 64),
      });
    }
    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "over-budget.zip",
        declaredSize: LARGE_ARCHIVE_MAX_BYTES,
        uploadFingerprint: "9".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "job_source_budget_exceeded" });
  });

  it("re-planning the same content resumes: present parts are reported, only missing parts get targets", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { parts, totalSize } = multiPartZipParts();
    const fingerprint = fingerprintForParts(parts, totalSize);
    const first = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "resume.zip",
      declaredSize: totalSize,
      uploadFingerprint: fingerprint,
    });
    // Interrupted upload: only part 0 arrives.
    world.storage.put(first.parts[0].bucket, first.parts[0].path, Buffer.from(parts[0]));

    const resumed = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      // Resume identity is the fingerprint, NOT the name: a renamed file
      // with identical content still resumes the same archive.
      fileName: "renamed-on-device.zip",
      declaredSize: totalSize,
      uploadFingerprint: fingerprint,
    });
    expect(resumed.archiveId).toBe(first.archiveId);
    expect(resumed.presentParts).toEqual([0]);
    expect(resumed.parts.map((target) => target.index)).toEqual(
      first.parts.map((t) => t.index).filter((index) => index !== 0),
    );
  });

  it("a DIFFERENT archive with the same filename and size never attaches to stale parts", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const one = multiPartZipParts(11);
    const two = multiPartZipParts(77); // different content, same geometry
    expect(two.totalSize).toBe(one.totalSize);
    const fpOne = fingerprintForParts(one.parts, one.totalSize);
    const fpTwo = fingerprintForParts(two.parts, two.totalSize);
    expect(fpTwo).not.toBe(fpOne);

    // First upload is interrupted after part 0 was stored.
    const first = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "dossier.zip",
      declaredSize: one.totalSize,
      uploadFingerprint: fpOne,
    });
    world.storage.put(first.parts[0].bucket, first.parts[0].path, Buffer.from(one.parts[0]));

    // A different file that happens to share the name and byte size gets a
    // FRESH archive with fresh part paths — no stale part is reported
    // present and none is reused.
    const second = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "dossier.zip",
      declaredSize: two.totalSize,
      uploadFingerprint: fpTwo,
    });
    expect(second.archiveId).not.toBe(first.archiveId);
    expect(second.presentParts).toEqual([]);
    expect(second.parts).toHaveLength(first.parts.length);
    for (const target of second.parts) {
      expect(target.path).toContain(second.archiveId);
      expect(target.path).not.toContain(first.archiveId);
    }
    // The stale part still belongs exclusively to the first archive's paths.
    const stored = storedPartKeys(world, jobId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toContain(first.archiveId);
  });

  it("denies another publisher's job and never allocates staging for it", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    await expect(
      planJobArchiveUpload(world.deps, PUBLISHER, {
        jobId,
        fileName: "x.zip",
        declaredSize: PART,
        uploadFingerprint: ANY_FP,
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
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "late.zip",
        declaredSize: PART,
        uploadFingerprint: ANY_FP,
      }),
    ).rejects.toMatchObject({ code: "job_already_published" });
  });
});

describe("confirmJobArchiveUpload", () => {
  it("accepts only when every stored part exists with exactly the planned size — as uploaded_unverified, never verified", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { parts, totalSize } = smallZipParts();
    const plan = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "verify.zip",
      declaredSize: totalSize,
      uploadFingerprint: fingerprintForParts(parts, totalSize),
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
    // Storage acceptance is truthfully NOT byte verification: no part is
    // hash-verified yet and the status says exactly that.
    expect(archive?.status).toBe("uploaded_unverified");
    expect(archive?.parts.every((part) => !part.verified)).toBe(true);
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
      uploadFingerprint: fingerprintForParts(parts, totalSize),
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
      uploadFingerprint: ANY_FP,
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

  it("full simulated upload helper produces a stored (unverified) archive", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { parts, totalSize } = smallZipParts();
    const uploaded = await uploadArchiveParts(world, OWNER, jobId, "ok.zip", parts, totalSize);
    const archive = await world.deps.data.getArchive(uploaded.archiveId);
    expect(archive?.status).toBe("uploaded_unverified");
  });
});

describe("upload fingerprint", () => {
  it("distinguishes archives that differ only inside sampled interior/tail windows", () => {
    const size = 40 * 1024 * 1024;
    const base = patternBytes(size, 3);
    const midFlipped = Buffer.from(base);
    // Inside the second sampled window ([size/3, size/3 + 256 KiB)).
    midFlipped[Math.floor(size / 3) + 100] ^= 0xff;
    const tailFlipped = Buffer.from(base);
    tailFlipped[size - 10] ^= 0xff;

    const split = (buffer: Buffer) => {
      const parts: Buffer[] = [];
      for (let start = 0; start < buffer.length; start += PART) {
        parts.push(buffer.subarray(start, Math.min(buffer.length, start + PART)));
      }
      return parts;
    };
    const fpBase = fingerprintForParts(split(base), size);
    const fpMid = fingerprintForParts(split(midFlipped), size);
    const fpTail = fingerprintForParts(split(tailFlipped), size);
    expect(fpBase).toMatch(/^[0-9a-f]{64}$/);
    expect(fpMid).not.toBe(fpBase);
    expect(fpTail).not.toBe(fpBase);
    // Deterministic for identical content.
    expect(fingerprintForParts(split(base), size)).toBe(fpBase);
    // Same content, different length → different identity.
    const shorter = base.subarray(0, size - 1);
    expect(fingerprintForParts(split(Buffer.from(shorter)), size - 1)).not.toBe(fpBase);
  });
});
