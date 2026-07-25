/**
 * Large-archive chunked upload contract: plan geometry and budgets, signed
 * part targets into PRIVATE staging, the EXACT per-part manifest resume
 * identity (every byte hashed — the retired sampled fingerprint cannot come
 * back), server-side stored-byte acceptance (existence + exact size —
 * truthfully NOT byte verification), and the authorization boundary.
 */

import { describe, expect, it } from "vitest";

import { StudioAccessError } from "../server/contracts";
import { deriveManifestSha256 } from "../server/large-archive";
import { PRIVATE_SOURCE_BUCKET } from "../server/extraction";
import { confirmJobArchiveUpload, planJobArchiveUpload, processUploadJob } from "../server/service";
import { ARCHIVE_PART_BYTES, LARGE_ARCHIVE_MAX_BYTES } from "../studio-types";
import { makeWorld, OWNER, PUBLISHER } from "./fakes";
import {
  buildZipParts,
  manifestForParts,
  patternBytes,
  sha256HexSync,
  splitBuffer,
  startArchiveJob,
  storedPartKeys,
  uploadArchiveParts,
} from "./large-archive-fixtures";

const PART = ARCHIVE_PART_BYTES;

/** Well-formed synthetic manifest for validation-only plans that never upload. */
function dummyManifest(declaredSize: number): string[] {
  const count = Math.max(1, Math.ceil(declaredSize / PART));
  return Array.from({ length: count }, (_, index) =>
    sha256HexSync(Buffer.from(`dummy-part-${index}`)),
  );
}

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
  it("registers the part plan, binds the manifest, and issues one signed target per part into private staging", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const declaredSize = PART * 2 + 1234;
    const manifest = dummyManifest(declaredSize);
    const plan = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "dossier.zip",
      declaredSize,
      partSha256: manifest,
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
    // The COMPLETE per-part manifest is bound at plan time…
    expect(archive?.parts.map((part) => part.declaredSha256)).toEqual(manifest);
    // …and the stored identity is the server-derived manifest digest.
    expect(archive?.manifest_sha256).toBe(await deriveManifestSha256(declaredSize, PART, manifest));
    expect(archive?.archive_sha256).toBeNull();
  });

  it("rejects non-ZIP names, malformed manifests, oversized archives, archive-count and source budgets", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "movie.mp4",
        declaredSize: PART,
        partSha256: dummyManifest(PART),
      }),
    ).rejects.toMatchObject({ code: "archive_not_zip" });
    // Non-hex digest.
    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "bad-digest.zip",
        declaredSize: PART,
        partSha256: ["not-a-digest"],
      }),
    ).rejects.toMatchObject({ code: "archive_manifest_invalid" });
    // Wrong part count for the declared size (manifest must cover EVERY part).
    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "short-manifest.zip",
        declaredSize: PART * 2 + 1,
        partSha256: dummyManifest(PART),
      }),
    ).rejects.toMatchObject({ code: "archive_manifest_invalid" });
    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "big.zip",
        declaredSize: LARGE_ARCHIVE_MAX_BYTES + 1,
        partSha256: dummyManifest(LARGE_ARCHIVE_MAX_BYTES + 1),
      }),
    ).rejects.toMatchObject({ code: "archive_too_large" });
    // Source budget: 1 GiB across the job's archives.
    for (let index = 0; index < 3; index += 1) {
      await planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: `part-${index}.zip`,
        declaredSize: LARGE_ARCHIVE_MAX_BYTES,
        partSha256: Array.from({ length: Math.ceil(LARGE_ARCHIVE_MAX_BYTES / PART) }, (_, i) =>
          sha256HexSync(Buffer.from(`budget-${index}-${i}`)),
        ),
      });
    }
    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "over-budget.zip",
        declaredSize: LARGE_ARCHIVE_MAX_BYTES,
        partSha256: Array.from({ length: Math.ceil(LARGE_ARCHIVE_MAX_BYTES / PART) }, (_, i) =>
          sha256HexSync(Buffer.from(`overflow-${i}`)),
        ),
      }),
    ).rejects.toMatchObject({ code: "job_source_budget_exceeded" });
  });

  it("re-planning the same content resumes: present parts are reported, only missing parts get targets", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { parts, totalSize } = multiPartZipParts();
    const manifest = manifestForParts(parts);
    const first = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "resume.zip",
      declaredSize: totalSize,
      partSha256: manifest,
    });
    // Interrupted upload: only part 0 arrives.
    world.storage.put(first.parts[0].bucket, first.parts[0].path, Buffer.from(parts[0]));

    const resumed = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      // Resume identity is the manifest, NOT the name: a renamed file with
      // identical content still resumes the same archive.
      fileName: "renamed-on-device.zip",
      declaredSize: totalSize,
      partSha256: manifest,
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
    const manifestOne = manifestForParts(one.parts);
    const manifestTwo = manifestForParts(two.parts);
    expect(manifestTwo).not.toEqual(manifestOne);

    // First upload is interrupted after part 0 was stored.
    const first = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "dossier.zip",
      declaredSize: one.totalSize,
      partSha256: manifestOne,
    });
    world.storage.put(first.parts[0].bucket, first.parts[0].path, Buffer.from(one.parts[0]));

    // A different file that happens to share the name and byte size gets a
    // FRESH archive with fresh part paths — no stale part is reported
    // present and none is reused.
    const second = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "dossier.zip",
      declaredSize: two.totalSize,
      partSha256: manifestTwo,
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

  it("REGRESSION: same name + size differing ONLY in a region the retired sampled fingerprint never read produce different upload records", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    // 40 MiB file; the v1 fingerprint sampled [0,256K), [size/3,+256K),
    // [2·size/3,+256K), [size-256K,size). Byte 9 MiB + 5 sits in NONE of
    // those windows — under the old contract both files got the SAME
    // fingerprint and the second could attach to the first's stored parts.
    const size = 40 * 1024 * 1024;
    const base = patternBytes(size, 3);
    const flipped = Buffer.from(base);
    const flipAt = 9 * 1024 * 1024 + 5;
    flipped[flipAt] ^= 0xff;

    const baseParts = splitBuffer(base, PART);
    const flippedParts = splitBuffer(flipped, PART);
    const manifestBase = manifestForParts(baseParts);
    const manifestFlipped = manifestForParts(flippedParts);
    // The manifests differ exactly at the flipped part, nowhere else.
    expect(manifestFlipped).not.toEqual(manifestBase);
    expect(manifestFlipped.filter((d, i) => d !== manifestBase[i])).toHaveLength(1);

    // First upload is interrupted: parts 0-2 stored (including the region
    // around the later flip).
    const first = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "dossier.zip",
      declaredSize: size,
      partSha256: manifestBase,
    });
    for (const index of [0, 1, 2]) {
      world.storage.put(
        first.parts[index].bucket,
        first.parts[index].path,
        Buffer.from(baseParts[index]),
      );
    }

    // The flipped file — same name, same size, difference only in a
    // previously-unsampled region — gets a FRESH archive: no stale parts
    // are reported present, and none of its targets touch the first's paths.
    const second = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "dossier.zip",
      declaredSize: size,
      partSha256: manifestFlipped,
    });
    expect(second.archiveId).not.toBe(first.archiveId);
    expect(second.presentParts).toEqual([]);
    for (const target of second.parts) {
      expect(target.path).toContain(second.archiveId);
    }
  });

  it("denies another publisher's job and never allocates staging for it", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    await expect(
      planJobArchiveUpload(world.deps, PUBLISHER, {
        jobId,
        fileName: "x.zip",
        declaredSize: PART,
        partSha256: dummyManifest(PART),
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
        partSha256: dummyManifest(PART),
      }),
    ).rejects.toMatchObject({ code: "job_already_published" });
  });
});

describe("confirmJobArchiveUpload", () => {
  it("accepts only when every stored part exists with exactly the planned size — as uploaded_unverified, never verified", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { parts, totalSize } = smallZipParts();
    const manifest = manifestForParts(parts);
    const plan = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "verify.zip",
      declaredSize: totalSize,
      partSha256: manifest,
    });
    // Nothing uploaded yet: not accepted, every part reported missing.
    const early = await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId,
      archiveId: plan.archiveId,
      partSha256: manifest,
    });
    expect(early.accepted).toBe(false);
    expect(early.missingParts.map((t) => t.index)).toEqual(parts.map((_, index) => index));

    for (const target of plan.parts) {
      world.storage.put(target.bucket, target.path, Buffer.from(parts[target.index]));
    }
    const accepted = await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId,
      archiveId: plan.archiveId,
      partSha256: manifest,
    });
    expect(accepted.accepted).toBe(true);
    const archive = await world.deps.data.getArchive(plan.archiveId);
    // Storage acceptance is truthfully NOT byte verification: no part is
    // hash-verified yet and the status says exactly that.
    expect(archive?.status).toBe("uploaded_unverified");
    expect(archive?.parts.every((part) => !part.verified)).toBe(true);
    // The plan-time manifest claims survive confirmation untouched.
    expect(archive?.parts.map((part) => part.declaredSha256)).toEqual(manifest);
    expect(archive?.observed_size).toBe(totalSize);
    // Idempotent re-confirm with the SAME manifest.
    const again = await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId,
      archiveId: plan.archiveId,
      partSha256: manifest,
    });
    expect(again.accepted).toBe(true);
  });

  it("REGRESSION: an accepted archive can never be confirmed by a different manifest", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { parts, totalSize } = smallZipParts();
    const uploaded = await uploadArchiveParts(
      world,
      OWNER,
      jobId,
      "accepted.zip",
      parts,
      totalSize,
    );
    const before = await world.deps.data.getArchive(uploaded.archiveId);
    expect(before?.status).toBe("uploaded_unverified");

    // A caller holding DIFFERENT bytes (any single digest differs) is
    // refused outright — never an idempotent "accepted".
    const foreign = manifestForParts(parts).map((digest, index) =>
      index === 0 ? sha256HexSync(Buffer.from("other-bytes")) : digest,
    );
    await expect(
      confirmJobArchiveUpload(world.deps, OWNER, {
        jobId,
        archiveId: uploaded.archiveId,
        partSha256: foreign,
      }),
    ).rejects.toMatchObject({ code: "archive_manifest_mismatch" });
    // A wrong-length manifest is refused the same way.
    await expect(
      confirmJobArchiveUpload(world.deps, OWNER, {
        jobId,
        archiveId: uploaded.archiveId,
        partSha256: manifestForParts(parts).slice(0, -1),
      }),
    ).rejects.toMatchObject({ code: "archive_manifest_mismatch" });
    // The accepted archive is unchanged by the refused attempts.
    const after = await world.deps.data.getArchive(uploaded.archiveId);
    expect(after).toEqual(before);
  });

  it("removes wrong-sized stored parts and returns fresh targets for them", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { parts, totalSize } = multiPartZipParts();
    const manifest = manifestForParts(parts);
    const plan = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "wrong-size.zip",
      declaredSize: totalSize,
      partSha256: manifest,
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
      partSha256: manifest,
    });
    expect(result.accepted).toBe(false);
    expect(result.missingParts.map((target) => target.index)).toEqual([1]);
    // The wrong-sized object was removed so the fresh target can rewrite it.
    expect(await world.storage.statObject(plan.parts[1].bucket, plan.parts[1].path)).toBeNull();
  });

  it("rejects a malformed part manifest and foreign archives", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { parts, totalSize } = smallZipParts();
    const manifest = manifestForParts(parts);
    const plan = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "manifest.zip",
      declaredSize: totalSize,
      partSha256: manifest,
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
        partSha256: manifest,
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

describe("manifest identity", () => {
  it("is deterministic, covers every byte, and changes when size, geometry, or ANY digest changes", async () => {
    const size = 20 * 1024 * 1024;
    const base = patternBytes(size, 3);
    const manifest = manifestForParts(splitBuffer(base, PART));
    const identity = await deriveManifestSha256(size, PART, manifest);
    expect(identity).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic for identical input.
    expect(await deriveManifestSha256(size, PART, manifest)).toBe(identity);
    // A single flipped byte anywhere changes exactly one digest → new identity.
    const flipped = Buffer.from(base);
    flipped[7 * 1024 * 1024] ^= 0xff;
    const manifestFlipped = manifestForParts(splitBuffer(flipped, PART));
    expect(await deriveManifestSha256(size, PART, manifestFlipped)).not.toBe(identity);
    // Same digests, different declared size → different identity.
    expect(await deriveManifestSha256(size - 1, PART, manifest)).not.toBe(identity);
    // Same digests, different part size → different identity.
    expect(await deriveManifestSha256(size, PART / 2, manifest)).not.toBe(identity);
    // Reordered digests → different identity (order is part of the identity).
    const reversed = [...manifest].reverse();
    expect(reversed).not.toEqual(manifest);
    expect(await deriveManifestSha256(size, PART, reversed)).not.toBe(identity);
  });
});
