/**
 * FOREVER-R2-MEDIA-STORAGE-CUTOVER-001 — the storage provider contract.
 *
 * The invariants proven here are the ones that make the cutover safe rather
 * than merely functional:
 *
 *   - the write-provider setting has a documented answer for EVERY input,
 *     including the ones nobody meant to type;
 *   - the provider is decided once, at job creation, and persisted;
 *   - retry, resume and scheduled processing read the JOB's provider, never
 *     the current global setting;
 *   - an R2 failure fails CLOSED — there is no path back to Supabase Storage;
 *   - a job created on R2 makes ZERO Supabase Storage writes;
 *   - object keys are server-generated, immutable, job-scoped, and carry no
 *     filename or other personal data.
 */

import { describe, expect, it } from "vitest";

import { PRIVATE_SOURCE_BUCKET, PUBLIC_IMAGE_BUCKET } from "../server/extraction";
import { processClaimedJob, processUploadJob, startUploadJob } from "../server/service";
import {
  archiveStorageState,
  JOB_STORAGE_FACTS_KEY,
  jobStorageProvider,
} from "../server/storage/job-provider";
import {
  assertSafeLogicalPath,
  bucketKindForLogicalBucket,
  LOGICAL_ARCHIVE_BUCKET,
  LOGICAL_PRIVATE_SOURCE_BUCKET,
  LOGICAL_PUBLIC_DOCUMENT_BUCKET,
  LOGICAL_PUBLIC_IMAGE_BUCKET,
  r2ArchiveObjectPath,
  r2ObjectKey,
  r2StagingPathForJobFile,
} from "../server/storage/r2-layout";
import { DEFAULT_R2_BUCKETS, resolveWriteProviderFromEnv } from "../server/storage/registry.server";
import {
  DEFAULT_STUDIO_WRITE_PROVIDER,
  resolveWriteProviderValue,
  STUDIO_STORAGE_WRITE_PROVIDER_ENV,
  STUDIO_WRITE_PROVIDER_INVALID_CODE,
} from "../server/storage/write-provider";
import { assertLocalR2Endpoint, LOCAL_R2_ENDPOINT } from "./local-r2";
import { makeWorld, OWNER, TEST_R2_BUCKETS, uploadAllViaTransport, type FakeWorld } from "./fakes";

function r2World(): FakeWorld {
  const world = makeWorld();
  // Prove the target is local and disposable BEFORE the first write.
  assertLocalR2Endpoint(world.r2.endpoint);
  expect(world.r2.endpoint).toBe(LOCAL_R2_ENDPOINT);
  world.flags.writeProvider = "r2";
  return world;
}

async function runPhotoJob(world: FakeWorld) {
  const started = await startUploadJob(world.deps, OWNER, {
    workflow: "new_development",
    projectFacts: { name: "R2 Provider Contract" },
    files: [{ name: "hero.jpg", materialPurpose: "project_photo" }],
  });
  await uploadAllViaTransport(world, started.uploads);
  const result = await processUploadJob(world.deps, OWNER, started.jobId);
  return { started, result };
}

describe("write-provider resolution", () => {
  it("has one documented answer for every configured value", () => {
    for (const absent of [undefined, null, "", "   ", "\t\n"]) {
      const resolved = resolveWriteProviderValue(absent);
      expect(resolved.provider, String(absent)).toBe(DEFAULT_STUDIO_WRITE_PROVIDER);
      expect(resolved.defaulted).toBe(true);
      expect(resolved.invalidCode).toBeNull();
    }
    for (const [raw, expected] of [
      ["supabase", "supabase"],
      ["r2", "r2"],
      ["  R2  ", "r2"],
      ["SUPABASE", "supabase"],
    ] as const) {
      expect(resolveWriteProviderValue(raw).provider, raw).toBe(expected);
    }
    // A NON-EMPTY value Forever does not recognize is a broken deployment
    // variable, not a request for the old behaviour.
    for (const bad of ["s3", "cloudflare", "r 2", "supabase,r2", 2, true, {}]) {
      const resolved = resolveWriteProviderValue(bad);
      expect(resolved.provider, String(bad)).toBeNull();
      expect(resolved.invalidCode).toBe(STUDIO_WRITE_PROVIDER_INVALID_CODE);
    }
  });

  it("defaults to the pre-cutover provider and refuses an unrecognized one", () => {
    expect(resolveWriteProviderFromEnv({} as NodeJS.ProcessEnv)).toBe("supabase");
    expect(
      resolveWriteProviderFromEnv({
        [STUDIO_STORAGE_WRITE_PROVIDER_ENV]: "r2",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe("r2");
    expect(() =>
      resolveWriteProviderFromEnv({
        [STUDIO_STORAGE_WRITE_PROVIDER_ENV]: "r3",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/does not recognize/);
    // The refusal carries the stable code, and never echoes the bad value.
    try {
      resolveWriteProviderFromEnv({
        [STUDIO_STORAGE_WRITE_PROVIDER_ENV]: "r3",
      } as unknown as NodeJS.ProcessEnv);
      expect.unreachable();
    } catch (error) {
      expect((error as { code?: string }).code).toBe(STUDIO_WRITE_PROVIDER_INVALID_CODE);
      expect((error as Error).message).not.toContain("r3");
    }
  });

  it("names the three production buckets as the defaults", () => {
    expect(DEFAULT_R2_BUCKETS).toEqual({
      privateSources: "forever-private-sources",
      publicMedia: "forever-public-media",
      projectArchives: "forever-project-archives",
    });
  });
});

describe("R2 object layout", () => {
  it("maps every logical bucket to exactly one kind", () => {
    expect(bucketKindForLogicalBucket(LOGICAL_PRIVATE_SOURCE_BUCKET)).toBe("private_source");
    expect(bucketKindForLogicalBucket(LOGICAL_PUBLIC_IMAGE_BUCKET)).toBe("public_media");
    expect(bucketKindForLogicalBucket(LOGICAL_PUBLIC_DOCUMENT_BUCKET)).toBe("public_media");
    expect(bucketKindForLogicalBucket(LOGICAL_ARCHIVE_BUCKET)).toBe("project_archives");
    expect(bucketKindForLogicalBucket("something-else")).toBeNull();
  });

  it("puts public objects — and only public objects — under media/", () => {
    expect(r2ObjectKey(LOGICAL_PUBLIC_IMAGE_BUCKET, "studio/job/att/00-abc.jpg")).toBe(
      "media/i/studio/job/att/00-abc.jpg",
    );
    // The two public logical buckets share one R2 bucket but NOT one key
    // namespace, so each stays independently sweepable.
    expect(r2ObjectKey(LOGICAL_PUBLIC_DOCUMENT_BUCKET, "studio/job/att/00-abc.jpg")).toBe(
      "media/d/studio/job/att/00-abc.jpg",
    );
    expect(r2ObjectKey(LOGICAL_PRIVATE_SOURCE_BUCKET, "jobs/j/staging/000/object")).toBe(
      "studio/jobs/j/staging/000/object",
    );
    expect(r2ObjectKey(LOGICAL_ARCHIVE_BUCKET, "archives/j/a/archive.zip")).toBe(
      "studio/archives/j/a/archive.zip",
    );
  });

  it("refuses a traversal, absolute, empty or ambiguous logical path", () => {
    for (const bad of [
      "",
      "/jobs/x",
      "jobs/../secrets",
      "jobs//x",
      "jobs/x/",
      "jobs/x?y",
      "jobs/x y",
      "jobs/x\\y",
      `jobs/${"a".repeat(1000)}`,
    ]) {
      expect(() => assertSafeLogicalPath(bad), bad).toThrow("r2_object_key_invalid");
    }
    expect(assertSafeLogicalPath("jobs/j/staging/000/object")).toBe("jobs/j/staging/000/object");
  });

  it("derives private keys from job identity alone — never from a filename", () => {
    const key = r2StagingPathForJobFile("job-1", 7);
    expect(key).toBe("jobs/job-1/staging/007/object");
    expect(key).not.toMatch(/\.(jpg|pdf|zip)$/);
    expect(r2ArchiveObjectPath("job-1", "arch-1")).toBe("archives/job-1/arch-1/archive.zip");
  });
});

describe("provider persistence", () => {
  it("records the provider on the job and on every declared file", async () => {
    const world = r2World();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      files: [
        { name: "hero.jpg", materialPurpose: "project_photo" },
        { name: "brochure.pdf", materialPurpose: "brochure" },
      ],
    });
    const job = await world.deps.data.getJob(started.jobId);
    expect(job).toBeTruthy();
    expect((job!.facts as Record<string, unknown>)[JOB_STORAGE_FACTS_KEY]).toEqual({
      provider: "r2",
    });
    expect(job!.files.map((file) => file.storageProvider)).toEqual(["r2", "r2"]);
    expect(jobStorageProvider(job!)).toBe("r2");
    // Every private key is server-generated and filename-free.
    for (const file of job!.files) {
      expect(file.stagingPath).toMatch(/^jobs\/[^/]+\/staging\/\d{3}\/object$/);
      expect(file.stagingPath).not.toContain("hero");
      expect(file.stagingPath).not.toContain("brochure");
    }
  });

  it("a manifest with no recorded provider resolves as the legacy Supabase lane", () => {
    expect(jobStorageProvider({ facts: {}, files: [] })).toBe("supabase");
    expect(jobStorageProvider({ facts: null, files: null })).toBe("supabase");
    // A hand-edited or partially written row still resolves from its files.
    expect(
      jobStorageProvider({
        facts: {},
        files: [{ storageProvider: "r2" } as never],
      }),
    ).toBe("r2");
    // An unrecognized stored value is treated as ABSENT, never trusted.
    expect(jobStorageProvider({ facts: { storage: { provider: "s3" } }, files: [] })).toBe(
      "supabase",
    );
  });

  it("a provider change after job creation does not move an existing job", async () => {
    const world = r2World();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Pinned Provider" },
      files: [{ name: "hero.jpg", materialPurpose: "project_photo" }],
    });
    await uploadAllViaTransport(world, started.uploads);

    // The deployment flips back to the legacy provider mid-flight.
    world.flags.writeProvider = "supabase";

    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");
    // The job still processed on R2 end to end.
    expect(world.storage.uploadCalls).toEqual([]);
    expect(world.storage.signedUploads).toEqual([]);
    expect(world.r2.keys(TEST_R2_BUCKETS.publicMedia).length).toBeGreaterThan(0);
  });
});

describe("no fallback from R2 to Supabase Storage", () => {
  it("refuses job creation when the selected provider is unavailable", async () => {
    const world = r2World();
    world.flags.r2Unavailable = true;
    await expect(
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        files: [{ name: "hero.jpg", materialPurpose: "project_photo" }],
      }),
    ).rejects.toThrow("storage_provider_unavailable");
    // Nothing was written anywhere.
    expect(world.storage.objects.size).toBe(0);
    expect(world.r2.objects.size).toBe(0);
  });

  /**
   * A provider refusal is a TERMINAL FAILURE, not an escaped exception.
   *
   * It used to be the latter, because provider resolution sat outside
   * `processClaimedJob`'s try block: the throw went straight past the failure
   * boundary, `failJob` never ran, and the job stayed claimed and `processing`
   * — occupying its own lease until it went stale, with nothing on the row to
   * say why. The no-fallback guarantee these tests exist to protect is
   * unchanged and asserted exactly as before; what changed is that the job now
   * ends up somewhere truthful.
   */
  it("fails an R2 job closed rather than processing it against Supabase", async () => {
    const world = r2World();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Fail Closed" },
      files: [{ name: "hero.jpg", materialPurpose: "project_photo" }],
    });
    await uploadAllViaTransport(world, started.uploads);
    const supabaseWritesBefore = world.storage.uploadCalls.length;

    world.flags.r2Unavailable = true;
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("storage_provider_unavailable");
    // No silent downgrade: not one Supabase Storage write happened.
    expect(world.storage.uploadCalls.length).toBe(supabaseWritesBefore);
    expect(world.storage.objects.size).toBe(0);
    // And the job is not published — nor left claimed and processing.
    const job = await world.deps.data.getJob(started.jobId);
    expect(job?.status).toBe("failed");
    expect(job?.processing_token).toBeNull();
  });

  it("a scheduled continuation of an R2 job also refuses to touch Supabase", async () => {
    const world = r2World();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Scheduled Fail Closed" },
      files: [{ name: "hero.jpg", materialPurpose: "project_photo" }],
    });
    await uploadAllViaTransport(world, started.uploads);
    const job = await world.deps.data.getJob(started.jobId);
    const token = world.deps.newToken();
    // Readiness is what a browser signals; the scheduled runner then claims.
    const claimed = await world.deps.data.requestJobProcessing(job!.id, token, 900);
    expect(claimed).toBeTruthy();

    world.flags.r2Unavailable = true;
    const result = await processClaimedJob(world.deps, OWNER, claimed!, token);

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("storage_provider_unavailable");
    expect(world.storage.uploadCalls).toEqual([]);
    // The claim was released by the terminal transition, so the job is not
    // stuck holding a lease nobody will ever finish.
    const after = await world.deps.data.getJob(started.jobId);
    expect(after?.status).toBe("failed");
    expect(after?.processing_token).toBeNull();
  });
});

describe("Supabase Storage call sites on an R2 job", () => {
  it("makes zero signed-upload, upload or public-object calls", async () => {
    const world = r2World();
    const { result } = await runPhotoJob(world);
    expect(result.status).toBe("published");

    // NOT VACUOUS: the job genuinely did the whole job — verified the stored
    // bytes and published a derivative — and did all of it on R2. Without
    // these three lines the Supabase assertions below would also hold for a
    // job that silently did nothing at all.
    expect(result.warnings).toEqual([]);
    expect(world.r2.keys(TEST_R2_BUCKETS.privateSources).length).toBe(1);
    expect(world.r2.keys(TEST_R2_BUCKETS.publicMedia).length).toBe(1);

    expect(world.storage.signedUploads).toEqual([]);
    expect(world.storage.uploadCalls).toEqual([]);
    expect(world.storage.objects.size).toBe(0);
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toEqual([]);
    expect(world.storage.publicKeys(PRIVATE_SOURCE_BUCKET)).toEqual([]);
  });

  it("keeps the private original out of the public bucket", async () => {
    const world = r2World();
    await runPhotoJob(world);

    const publicKeys = world.r2.keys(TEST_R2_BUCKETS.publicMedia);
    const privateKeys = world.r2.keys(TEST_R2_BUCKETS.privateSources);
    expect(privateKeys.some((key) => key.startsWith("studio/jobs/"))).toBe(true);
    expect(publicKeys.length).toBeGreaterThan(0);
    for (const key of publicKeys) {
      expect(key.startsWith("media/")).toBe(true);
      // Never a private-source key, and never an original filename.
      expect(key).not.toContain("staging");
      expect(key).not.toContain("hero");
    }
    for (const key of privateKeys) {
      expect(key.startsWith("studio/")).toBe(true);
    }
  });

  it("publishes a same-origin Forever media URL, never an R2 or r2.dev host", async () => {
    const world = r2World();
    const { result } = await runPhotoJob(world);
    expect(result.status).toBe("published");
    const urls = world.executor.store.media.map((row) => row.url);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith("https://forever.test/media/")).toBe(true);
      expect(url).not.toContain("r2.dev");
      expect(url).not.toContain("cloudflarestorage");
      expect(url).not.toContain(TEST_R2_BUCKETS.publicMedia);
      expect(url).not.toContain("supabase");
    }
  });

  it("archives created on the legacy lane report the legacy storage state", () => {
    expect(
      archiveStorageState({
        extracted: null,
      } as never),
    ).toEqual({ provider: "supabase" });
    expect(
      archiveStorageState({
        extracted: { storage: { provider: "r2", objectKey: "k", multipartUploadId: "u" } },
      } as never),
    ).toEqual({ provider: "r2", objectKey: "k", multipartUploadId: "u" });
  });
});
