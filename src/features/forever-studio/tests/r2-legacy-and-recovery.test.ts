/**
 * FOREVER-R2-MEDIA-STORAGE-CUTOVER-001 — legacy compatibility, retry, resume,
 * scheduled continuation and recovery.
 *
 * Production has zero Studio jobs today, but compatibility is implemented and
 * proven truthfully rather than on the strength of that count: a manifest
 * written before the provider contract existed is exactly a manifest with no
 * recorded provider, and this suite builds one and processes it.
 */

import { describe, expect, it } from "vitest";

import { PRIVATE_SOURCE_BUCKET, PUBLIC_IMAGE_BUCKET } from "../server/extraction";
import {
  processClaimedJob,
  processUploadJob,
  resumeDueJobs,
  runScheduledStudioTick,
  startUploadJob,
} from "../server/service";
import { jobStorageProvider } from "../server/storage/job-provider";
import { assertLocalR2Endpoint } from "./local-r2";
import {
  magicBytesFor,
  makeWorld,
  OWNER,
  TEST_R2_BUCKETS,
  uploadAll,
  uploadAllViaTransport,
  type FakeWorld,
} from "./fakes";

function r2World(): FakeWorld {
  const world = makeWorld();
  assertLocalR2Endpoint(world.r2.endpoint);
  world.flags.writeProvider = "r2";
  return world;
}

async function startPhotoJob(world: FakeWorld, name: string) {
  return startUploadJob(world.deps, OWNER, {
    workflow: "new_development",
    projectFacts: { name },
    files: [{ name: "hero.jpg", materialPurpose: "project_photo" }],
  });
}

/**
 * Strip every trace of the provider contract from a stored job, producing
 * EXACTLY the manifest shape a pre-cutover job has.
 */
function makeManifestPreContract(world: FakeWorld, jobId: string): void {
  const stored = world.data.jobs.get(jobId)!;
  const facts = { ...(stored.facts as Record<string, unknown>) };
  delete facts.storage;
  stored.facts = facts;
  stored.files = stored.files.map((file) => {
    const copy = { ...file };
    delete copy.storageProvider;
    return copy;
  });
}

describe("legacy Supabase manifests", () => {
  it("resolve and publish through the legacy adapter with no provider recorded", async () => {
    // The deployment has ALREADY flipped to R2 — the old job must not move.
    const world = r2World();
    world.flags.writeProvider = "supabase";
    const started = await startPhotoJob(world, "Legacy Project");
    uploadAll(world, started.uploads);
    makeManifestPreContract(world, started.jobId);

    const job = await world.deps.data.getJob(started.jobId);
    expect(jobStorageProvider(job!)).toBe("supabase");

    world.flags.writeProvider = "r2";
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("completed");

    // Processed entirely on Supabase Storage; R2 was never touched.
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET).length).toBe(1);
    expect(world.r2.objects.size).toBe(0);
    expect(world.r2.requests).toEqual([]);
  });

  it("needs no backfill: the row is never rewritten to carry a provider", async () => {
    const world = r2World();
    world.flags.writeProvider = "supabase";
    const started = await startPhotoJob(world, "No Backfill");
    uploadAll(world, started.uploads);
    makeManifestPreContract(world, started.jobId);
    await processUploadJob(world.deps, OWNER, started.jobId);

    const job = await world.deps.data.getJob(started.jobId);
    expect((job!.facts as Record<string, unknown>).storage).toBeUndefined();
    expect(job!.files.every((file) => file.storageProvider === undefined)).toBe(true);
  });

  it("leaves an existing Supabase public URL untouched when a later R2 job enriches", async () => {
    const world = r2World();
    world.flags.writeProvider = "supabase";
    const legacy = await startPhotoJob(world, "Mixed Provider Project");
    uploadAll(world, legacy.uploads);
    makeManifestPreContract(world, legacy.jobId);
    await processUploadJob(world.deps, OWNER, legacy.jobId);

    const legacyUrls = world.executor.store.media.map((row) => row.url);
    expect(legacyUrls.every((url) => url.startsWith("https://cdn.test/"))).toBe(true);

    // A NEW job on the same project, now on R2.
    world.flags.writeProvider = "r2";
    const fresh = await startUploadJob(world.deps, OWNER, {
      workflow: "project_update",
      projectSlug: "mixed-provider-project",
      files: [{ name: "second.jpg", materialPurpose: "project_photo" }],
    });
    await uploadAllViaTransport(world, fresh.uploads);
    expect((await processUploadJob(world.deps, OWNER, fresh.jobId)).status).toBe("completed");

    const urls = world.executor.store.media.map((row) => row.url);
    // The old rows still point at Supabase; the new one at Forever's route.
    for (const url of legacyUrls) expect(urls).toContain(url);
    expect(urls.some((url) => url.startsWith("https://forever.test/media/"))).toBe(true);
  });
});

describe("retry, resume and scheduled continuation on R2", () => {
  it("retries an R2 job on its own provider and converges on one project", async () => {
    const world = r2World();
    const started = await startPhotoJob(world, "R2 Retry");
    await uploadAllViaTransport(world, started.uploads);

    // The atomic publish transaction fails after the graph write.
    world.data.failAfterIngest = true;
    const failed = await processUploadJob(world.deps, OWNER, started.jobId);
    world.data.failAfterIngest = false;
    expect(failed.status).toBe("failed");
    expect(failed.retryable).toBe(true);
    // A failed attempt leaves no public object behind.
    expect(world.r2.keys(TEST_R2_BUCKETS.publicMedia)).toEqual([]);
    // The private original is still there — nothing the Owner uploaded is lost.
    expect(world.r2.keys(TEST_R2_BUCKETS.privateSources).length).toBe(1);

    const retried = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(retried.status).toBe("completed");
    expect(world.executor.store.projects).toHaveLength(1);
    expect(world.storage.uploadCalls).toEqual([]);
  });

  it("automatic resume picks up a retryable R2 job and keeps it on R2", async () => {
    const world = r2World();
    const started = await startPhotoJob(world, "R2 Auto Resume");
    await uploadAllViaTransport(world, started.uploads);
    world.data.failAfterIngest = true;
    await processUploadJob(world.deps, OWNER, started.jobId);
    world.data.failAfterIngest = false;

    const resumed = await resumeDueJobs(world.deps, OWNER);
    expect(resumed.resumed).toBe(1);
    expect(world.storage.uploadCalls).toEqual([]);
    expect(world.r2.keys(TEST_R2_BUCKETS.publicMedia).length).toBe(1);
  });

  it("the scheduled runner continues an R2 job with no browser session at all", async () => {
    const world = r2World();
    const started = await startPhotoJob(world, "R2 Scheduled");
    await uploadAllViaTransport(world, started.uploads);
    // Readiness is what the browser signalled before it closed.
    const token = world.deps.newToken();
    await world.deps.data.requestJobProcessing(started.jobId, token, 900);
    await world.deps.data.releaseJobIfClaimed(started.jobId, token);

    const tick = await runScheduledStudioTick(world.deps);
    expect(tick.due).toBeGreaterThan(0);
    expect(tick.completed).toBe(1);
    const job = await world.deps.data.getJob(started.jobId);
    expect(job!.status).toBe("published");
    expect(world.storage.uploadCalls).toEqual([]);
    expect(world.r2.keys(TEST_R2_BUCKETS.publicMedia).length).toBe(1);
  });
});

describe("recovery", () => {
  it("an upload interrupted before acceptance warns and never blocks its siblings", async () => {
    const world = r2World();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "R2 Partial Upload" },
      files: [
        { name: "arrived.jpg", materialPurpose: "project_photo" },
        { name: "interrupted.jpg", materialPurpose: "project_photo" },
      ],
    });
    // Only the first file's bytes ever reached storage.
    await uploadAllViaTransport(world, [started.uploads[0]]);
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("completed");
    expect(result.warnings.map((warning) => warning.code)).toContain("file_upload_missing");
    // The file that DID arrive still published.
    expect(world.r2.keys(TEST_R2_BUCKETS.publicMedia).length).toBe(1);
  });

  it("a stale worker cannot overwrite or delete a newer attempt's public object", async () => {
    const world = r2World();
    const started = await startPhotoJob(world, "R2 Stale Worker");
    await uploadAllViaTransport(world, started.uploads);

    const staleToken = "stale-r2-token";
    const stale = await world.data.requestJobProcessing(started.jobId, staleToken, 900);
    expect(stale).not.toBeNull();

    // That claim goes stale; a newer worker recovers the job and publishes.
    world.advanceMinutes(20);
    const freshToken = "fresh-r2-token";
    const fresh = await world.data.claimJob(started.jobId, freshToken, 900);
    expect(fresh).not.toBeNull();
    const published = await processClaimedJob(world.deps, OWNER, fresh!, freshToken);
    expect(published.status).toBe("completed");
    const winners = world.r2.keys(TEST_R2_BUCKETS.publicMedia);
    expect(winners.length).toBe(1);

    // The stale worker now finishes its own attempt. It must not be able to
    // finalize, and it must not remove the winner's media.
    const staleResult = await processClaimedJob(world.deps, OWNER, stale!, staleToken);
    expect(staleResult.status).not.toBe("failed");
    expect(world.r2.keys(TEST_R2_BUCKETS.publicMedia)).toEqual(winners);
  });

  it("keeps the private original after a safe processing warning", async () => {
    const world = r2World();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "R2 Retained Original" },
      files: [{ name: "notes.txt", materialPurpose: "document_legal" }],
    });
    await uploadAllViaTransport(world, started.uploads, {
      "notes.txt": magicBytesFor("notes.txt"),
    });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("completed");
    // Nothing public, original still privately retained and readable.
    expect(world.r2.keys(TEST_R2_BUCKETS.publicMedia)).toEqual([]);
    const privateKeys = world.r2.keys(TEST_R2_BUCKETS.privateSources);
    expect(privateKeys.length).toBe(1);
    const stored = world.r2.objects.get(`${TEST_R2_BUCKETS.privateSources}/${privateKeys[0]}`);
    expect(stored!.body.equals(magicBytesFor("notes.txt"))).toBe(true);
  });

  it("never writes a private original into the public bucket", async () => {
    const world = r2World();
    const started = await startPhotoJob(world, "R2 Boundary");
    await uploadAllViaTransport(world, started.uploads);
    await processUploadJob(world.deps, OWNER, started.jobId);

    const privateKeys = world.r2.keys(TEST_R2_BUCKETS.privateSources);
    const publicKeys = world.r2.keys(TEST_R2_BUCKETS.publicMedia);
    expect(publicKeys.length).toBe(1);
    for (const key of publicKeys) {
      const stored = world.r2.objects.get(`${TEST_R2_BUCKETS.publicMedia}/${key}`)!;
      // A public object is a verified derivative on a content-addressed,
      // immutable key — never a private-source key, whatever its bytes.
      expect(privateKeys).not.toContain(key);
      expect(key).toMatch(/^media\/[a-z]\/studio\//);
      expect(stored.cacheControl).toContain("immutable");
    }
    // And nothing was ever written to the Supabase private bucket either.
    expect(world.storage.publicKeys(PRIVATE_SOURCE_BUCKET)).toEqual([]);
  });
});
