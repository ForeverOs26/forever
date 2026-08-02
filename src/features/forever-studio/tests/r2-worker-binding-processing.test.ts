/**
 * FOREVER-CORALINA-R2-WORKER-BINDING-FIX-PR-001 — Worker-side R2 object plane.
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * The first real R2 production pilot uploaded six Owner-selected files — three
 * photographs and three documents, 51,937,418 bytes — into the private bucket
 * without a single failure, and then could not process them. Every browser
 * presigned PUT succeeded; every request the WORKER itself made rejected at
 * `fetch` before reaching R2, so the very first object HEAD threw and the job
 * failed seven times with one uninformative word: `processing_failed`.
 *
 * The existing R2 suites could not have caught it. They exercise the same
 * implementation over a `fetch` that works, because Node's does. So this suite
 * runs the provider in WORKER mode, where:
 *
 *   - server-side object operations go through native bucket bindings;
 *   - the S3 client's `fetch` REJECTS, exactly as it does on a Worker;
 *   - presigning still works, because it never makes a request — which is why
 *     the browser half of the design was fine all along.
 *
 * Every test here fails against the base implementation, because the base
 * implementation has no Worker path at all.
 *
 * NOTHING IN THIS FILE TOUCHES PRODUCTION. The bindings are in-process views
 * over the in-process S3 harness on the reserved, non-routable
 * `local-r2.invalid` host. No production job id, filename or object key appears
 * anywhere in it: the Coralina-equivalent manifest below is a SANITIZED
 * reconstruction — same shape, same purposes, same ordering, same file types,
 * neutral names and small synthetic bytes.
 */

import { describe, expect, it } from "vitest";

import { PRIVATE_SOURCE_BUCKET, PUBLIC_IMAGE_BUCKET } from "../server/extraction";
import {
  JOB_PROCESSING_FACTS_KEY,
  STUDIO_STAGE_TELEMETRY_KEYS,
  type StudioStageTelemetry,
} from "../server/processing-stage";
import {
  automaticFailureCount,
  JOB_RETRY_FACTS_KEY,
  STUDIO_AUTOMATIC_RETRY_LIMIT,
} from "../server/retry-policy";
import {
  processUploadJob,
  resumeDueJobs,
  runScheduledStudioTick,
  startUploadJob,
} from "../server/service";
import {
  isWorkerRuntime,
  resolveR2BindingsFrom,
  STUDIO_R2_BINDING_NAMES,
} from "../server/storage/r2-bindings.server";
import { R2Client } from "../server/storage/r2-client.server";
import { createR2StorageProvider } from "../server/storage/r2-provider.server";
import { r2StagingPathForJobFile } from "../server/storage/r2-layout";
import {
  createStudioStorageProviders,
  resolveStudioR2Runtime,
} from "../server/storage/registry.server";
import { assertLocalR2Endpoint } from "./local-r2";
import { withWorkerRuntime } from "./local-r2-binding";
import {
  magicBytesFor,
  makeWorld,
  OWNER,
  TEST_PUBLIC_MEDIA_ORIGIN,
  TEST_R2_BUCKETS,
  uploadAllViaTransport,
  type FakeWorld,
} from "./fakes";

// ---------------------------------------------------------------------------
// The sanitized Coralina-equivalent manifest
// ---------------------------------------------------------------------------

/**
 * EXACTLY the shape of the contained production job, with nothing of its
 * identity: six declared files, three JPEG project photos followed by three
 * PDFs, one Brochure, one Price List, one Developer Profile, NO Payment Plan
 * and NO archive. Ordering is preserved because the production failure was
 * positional — it died on ordinal 1 purely because ordinal 1 was first.
 */
const CORALINA_EQUIVALENT_MANIFEST = [
  { name: "material-01.jpg", materialPurpose: "project_photo" as const },
  { name: "material-02.jpg", materialPurpose: "project_photo" as const },
  { name: "material-03.jpg", materialPurpose: "project_photo" as const },
  { name: "material-04.pdf", materialPurpose: "brochure" as const },
  { name: "material-05.pdf", materialPurpose: "price_list" as const },
  { name: "material-06.pdf", materialPurpose: "developer_profile" as const },
];

function workerWorld(): FakeWorld {
  const world = makeWorld({ r2Runtime: "worker" });
  assertLocalR2Endpoint(world.r2.endpoint);
  world.flags.writeProvider = "r2";
  return world;
}

function nodeR2World(): FakeWorld {
  const world = makeWorld();
  assertLocalR2Endpoint(world.r2.endpoint);
  world.flags.writeProvider = "r2";
  return world;
}

async function startCoralinaEquivalent(world: FakeWorld) {
  return startUploadJob(world.deps, OWNER, {
    workflow: "new_development",
    projectFacts: { name: "Sanitized Pilot Equivalent" },
    files: CORALINA_EQUIVALENT_MANIFEST.map((file) => ({ ...file })),
  });
}

/** Public objects this world holds, by the real bucket they live in. */
function publicMediaKeys(world: FakeWorld): string[] {
  return world.r2.keys(TEST_R2_BUCKETS.publicMedia);
}

function privateSourceKeys(world: FakeWorld): string[] {
  return world.r2.keys(TEST_R2_BUCKETS.privateSources);
}

// ---------------------------------------------------------------------------
// 1–5, 21 — the Worker-side object plane
// ---------------------------------------------------------------------------

describe("Worker processing uses native R2 bindings for every object operation", () => {
  it("publishes the six-file Coralina-equivalent manifest with the S3 server fetch disabled", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);
    // The BROWSER uploads through its presigned URLs — the half that always
    // worked — while the Worker's own S3 fetch is already refusing.
    await uploadAllViaTransport(world, started.uploads);
    expect(privateSourceKeys(world)).toHaveLength(6);
    world.workerR2.reset();

    const result = await withWorkerRuntime(world.workerR2.env, () =>
      processUploadJob(world.deps, OWNER, started.jobId),
    );

    expect(result.status).toBe("published");
    // (5) The Worker made ZERO server-side S3 requests during processing.
    expect(world.workerR2.serverFetchAttempts).toEqual([]);
    // (1) Object stat went through the private-sources binding.
    const privateCalls = world.workerR2.callsFor("private_source");
    expect(privateCalls.some((call) => call.op === "head")).toBe(true);
    // (2) Object read went through the same binding.
    expect(privateCalls.some((call) => call.op === "get")).toBe(true);
    expect(privateCalls.every((call) => call.bucket === TEST_R2_BUCKETS.privateSources)).toBe(true);
    // (3) Public derivatives were written through the public-media binding.
    const publicWrites = world.workerR2
      .callsFor("public_media")
      .filter((call) => call.op === "put");
    expect(publicWrites.length).toBeGreaterThan(0);
    expect(publicWrites.every((call) => call.bucket === TEST_R2_BUCKETS.publicMedia)).toBe(true);
    // (19) Every public object lives in public-media and nowhere else.
    expect(publicMediaKeys(world).length).toBe(publicWrites.length);
    expect(publicMediaKeys(world).every((key) => key.startsWith("media/"))).toBe(true);
    // (17) Exactly one project.
    expect(world.executor.store.projects.length).toBe(1);
    // (18) Supabase Storage received nothing at all.
    expect(world.storage.objects.size).toBe(0);
  });

  it("reads ranges through the binding and never through the S3 client", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);
    await uploadAllViaTransport(world, started.uploads);
    world.workerR2.reset();

    const provider = world.deps.storageProviders.get("r2");
    const path = r2StagingPathForJobFile(started.jobId, 0);
    const bytes = await provider.objects.downloadWithin(PRIVATE_SOURCE_BUCKET, path, 10_000_000);

    expect(bytes).not.toBeNull();
    expect(world.workerR2.serverFetchAttempts).toEqual([]);
    const ops = world.workerR2.callsFor("private_source").map((call) => call.op);
    expect(ops).toContain("head");
    expect(ops).toContain("get");
  });

  it("(4) deletes job-owned objects through the binding of the bucket that owns them", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);
    await uploadAllViaTransport(world, started.uploads);
    world.workerR2.reset();

    const provider = world.deps.storageProviders.get("r2");
    await provider.objects.remove(PRIVATE_SOURCE_BUCKET, [
      r2StagingPathForJobFile(started.jobId, 0),
    ]);

    const deletes = world.workerR2.calls.filter((call) => call.op === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].kind).toBe("private_source");
    expect(deletes[0].bucket).toBe(TEST_R2_BUCKETS.privateSources);
    expect(world.workerR2.serverFetchAttempts).toEqual([]);
    expect(privateSourceKeys(world)).toHaveLength(5);
  });

  it("refuses to delete a key outside a job prefix, on the binding plane too", async () => {
    const world = workerWorld();
    const provider = world.deps.storageProviders.get("r2");
    await expect(
      provider.objects.remove(PRIVATE_SOURCE_BUCKET, ["not-a-job/object"]),
    ).rejects.toThrow(/r2_delete_outside_job_scope/);
  });

  it("(21) a scheduled continuation processes through the binding-backed path", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);
    await uploadAllViaTransport(world, started.uploads);
    // Mark the job explicitly ready without processing it, exactly as an
    // interrupted browser session leaves it.
    const stored = world.data.jobs.get(started.jobId)!;
    stored.processing_requested_at = world.flags.nowValue;
    world.workerR2.reset();

    const tick = await withWorkerRuntime(world.workerR2.env, () =>
      runScheduledStudioTick(world.deps, {}),
    );

    expect(tick.published).toBe(1);
    expect(world.workerR2.serverFetchAttempts).toEqual([]);
    expect(world.workerR2.callsFor("private_source").some((call) => call.op === "head")).toBe(true);
    expect(world.workerR2.callsFor("public_media").some((call) => call.op === "put")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The production wiring itself — the generated Cloudflare/Nitro environment
// ---------------------------------------------------------------------------

describe("the real provider registry resolves bindings from the Worker environment", () => {
  /** Exactly the server-only variables the production Worker carries. */
  const WORKER_ENV: NodeJS.ProcessEnv = {
    R2_ACCOUNT_ID: "local-test-account",
    R2_ACCESS_KEY_ID: "LOCALTESTACCESSKEY",
    R2_SECRET_ACCESS_KEY: "local-test-secret-key-not-a-real-credential",
    R2_BUCKET_PRIVATE_SOURCES: TEST_R2_BUCKETS.privateSources,
    R2_BUCKET_PUBLIC_MEDIA: TEST_R2_BUCKETS.publicMedia,
    R2_BUCKET_PROJECT_ARCHIVES: TEST_R2_BUCKETS.projectArchives,
    FOREVER_PUBLIC_MEDIA_ORIGIN: TEST_PUBLIC_MEDIA_ORIGIN,
    STUDIO_STORAGE_WRITE_PROVIDER: "r2",
  };

  it("builds the WORKER provider under Nitro's __env__, and the node one without it", async () => {
    const world = workerWorld();

    // Off a Worker: the S3 object plane, exactly as local development uses.
    expect(resolveStudioR2Runtime()).toBe("node");

    await withWorkerRuntime(world.workerR2.env, async () => {
      expect(resolveStudioR2Runtime()).toBe("worker");
      const providers = createStudioStorageProviders(world.storage, WORKER_ENV);
      const provider = providers.get("r2");
      // Prove it is the BINDING plane by observing the binding, not by
      // trusting a flag: a stat lands on the private-sources binding.
      world.workerR2.reset();
      await provider.objects.statObject(PRIVATE_SOURCE_BUCKET, "jobs/x/staging/000/object");
      expect(world.workerR2.callsFor("private_source").map((call) => call.op)).toEqual(["head"]);
      // And the multipart control plane refuses rather than attempting S3.
      await expect(
        provider.beginArchiveUpload({
          jobId: "00000000-0000-4000-8000-000000000001",
          archiveId: "00000000-0000-4000-8000-000000000002",
          declaredSize: 8,
          partSize: 8,
          partCount: 1,
        }),
      ).rejects.toMatchObject({ code: "archive_control_plane_unavailable" });
    });

    expect(resolveStudioR2Runtime()).toBe("node");
  });

  it("fails closed on a Worker whose bindings are missing, with no S3 downgrade", async () => {
    const world = workerWorld();
    // A Worker environment with the SECRETS present and the BINDINGS absent —
    // precisely the deployment shape that produced the production defect.
    await withWorkerRuntime({}, async () => {
      const providers = createStudioStorageProviders(world.storage, WORKER_ENV);
      expect(() => providers.get("r2")).toThrow(/no usable bucket binding/);
    });
  });

  it("both Worker entry paths — fetch and scheduled — see the same bindings", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);
    await uploadAllViaTransport(world, started.uploads);

    // The scheduled entry path (cron → scheduled() → cloudflare:scheduled).
    const stored = world.data.jobs.get(started.jobId)!;
    stored.processing_requested_at = world.flags.nowValue;
    world.workerR2.reset();
    const scheduled = await withWorkerRuntime(world.workerR2.env, () =>
      runScheduledStudioTick(world.deps, {}),
    );
    expect(scheduled.published).toBe(1);
    const scheduledCalls = world.workerR2.calls.length;
    expect(scheduledCalls).toBeGreaterThan(0);

    // The fetch entry path (browser session → server function), same world.
    world.workerR2.reset();
    const fetched = await withWorkerRuntime(world.workerR2.env, () =>
      processUploadJob(world.deps, OWNER, started.jobId),
    );
    expect(fetched.status).toBe("published");
    // Neither path made a single server-side S3 request.
    expect(world.workerR2.serverFetchAttempts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6, 7 — what must NOT change
// ---------------------------------------------------------------------------

describe("browser direct upload and the no-fallback rule are preserved", () => {
  it("(6) still presigns browser direct uploads on a Worker, with no request of its own", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);

    expect(started.uploads).toHaveLength(6);
    for (const target of started.uploads) {
      expect(target.transport?.kind).toBe("r2_presigned_put");
      expect(target.transport && "url" in target.transport && target.transport.url).toMatch(
        /X-Amz-Signature=/,
      );
    }
    // Presigning is pure crypto: the refusing server fetch was never called.
    expect(world.workerR2.serverFetchAttempts).toEqual([]);

    // And the presigned URLs genuinely authorize the upload.
    await uploadAllViaTransport(world, started.uploads);
    expect(privateSourceKeys(world)).toHaveLength(6);
  });

  it("(7) never falls back to Supabase Storage when the R2 plane fails", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);
    await uploadAllViaTransport(world, started.uploads);
    // Break the private-source binding the way a broken deployment would.
    const restore = world.workerR2.failBinding("private_source", "head");

    const result = await withWorkerRuntime(world.workerR2.env, () =>
      processUploadJob(world.deps, OWNER, started.jobId),
    );
    restore();

    expect(result.status).toBe("failed");
    expect(world.storage.objects.size).toBe(0);
    expect(publicMediaKeys(world)).toEqual([]);
    expect(world.executor.store.projects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8, 9 — failing closed
// ---------------------------------------------------------------------------

describe("a missing or malformed binding fails closed", () => {
  it("(8) refuses to construct a Worker provider with no bindings", () => {
    const world = makeWorld();
    const client = new R2Client({
      accountId: "local-test-account",
      accessKeyId: world.r2.credentials.accessKeyId,
      secretAccessKey: world.r2.credentials.secretAccessKey,
      endpoint: world.r2.endpoint,
      fetchImpl: world.r2.fetchImpl,
    });

    expect(() =>
      createR2StorageProvider({
        client,
        runtime: "worker",
        bindings: null,
        buckets: TEST_R2_BUCKETS,
        publicOrigin: TEST_PUBLIC_MEDIA_ORIGIN,
      }),
    ).toThrow(/no usable bucket binding/);

    // The same config off a Worker is the ordinary S3 provider, unchanged.
    expect(() =>
      createR2StorageProvider({
        client,
        buckets: TEST_R2_BUCKETS,
        publicOrigin: TEST_PUBLIC_MEDIA_ORIGIN,
      }),
    ).not.toThrow();
  });

  it("(8) reports every missing binding name, and accepts only a complete set", () => {
    expect(resolveR2BindingsFrom(null).missing).toEqual([
      "R2_PRIVATE_SOURCES",
      "R2_PUBLIC_MEDIA",
      "R2_PROJECT_ARCHIVES",
    ]);

    const world = workerWorld();
    const partial = { ...world.workerR2.env };
    delete partial[STUDIO_R2_BINDING_NAMES.public_media];
    const resolution = resolveR2BindingsFrom(partial);
    expect(resolution.bindings).toBeNull();
    expect(resolution.missing).toEqual(["R2_PUBLIC_MEDIA"]);

    // A value that is not a bucket at all is "missing", not "usable".
    const malformed = { ...world.workerR2.env, R2_PRIVATE_SOURCES: { head: "not-a-function" } };
    expect(resolveR2BindingsFrom(malformed).missing).toEqual(["R2_PRIVATE_SOURCES"]);

    expect(resolveR2BindingsFrom(world.workerR2.env).bindings).not.toBeNull();
  });

  it("detects a Worker from either runtime signal, and a Node process from neither", async () => {
    expect(isWorkerRuntime({})).toBe(false);
    expect(isWorkerRuntime({ navigator: { userAgent: "Cloudflare-Workers" } })).toBe(true);
    expect(isWorkerRuntime({ __env__: { R2_PRIVATE_SOURCES: {} } })).toBe(true);
    const world = workerWorld();
    await withWorkerRuntime(world.workerR2.env, async () => {
      expect(isWorkerRuntime()).toBe(true);
    });
    expect(isWorkerRuntime()).toBe(false);
  });

  it("(9) a provider-resolution refusal reaches a truthful TERMINAL state", async () => {
    // The provider registry itself refuses — the shape of a deployment that
    // selected R2 and cannot build it. At base this threw PAST the failure
    // boundary and left the job claimed and `processing` forever.
    const world = nodeR2World();
    const started = await startCoralinaEquivalent(world);
    await uploadAllViaTransport(world, started.uploads);
    world.flags.r2Unavailable = true;

    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("failed");
    const job = await world.deps.data.getJob(started.jobId);
    expect(job?.status).toBe("failed");
    expect(job?.processing_token).toBeNull();
    // Nothing was published and nothing was written anywhere else.
    expect(world.executor.store.projects).toHaveLength(0);
    expect(publicMediaKeys(world)).toEqual([]);
    expect(world.storage.objects.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10, 11 — sanitized stage telemetry
// ---------------------------------------------------------------------------

function telemetryOf(world: FakeWorld, jobId: string): StudioStageTelemetry {
  const job = world.data.jobs.get(jobId)!;
  return (job.facts as Record<string, unknown>)[JOB_PROCESSING_FACTS_KEY] as StudioStageTelemetry;
}

describe("sanitized stage telemetry", () => {
  it("(10) records object_stat when the first server-side object check fails", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);
    await uploadAllViaTransport(world, started.uploads);
    const restore = world.workerR2.failBinding("private_source", "head");

    const result = await withWorkerRuntime(world.workerR2.env, () =>
      processUploadJob(world.deps, OWNER, started.jobId),
    );
    restore();

    // The production symptom, now diagnosable.
    expect(result.errorCode).toBe("object_stat_failed");
    expect(result.errorCode).not.toBe("processing_failed");
    const telemetry = telemetryOf(world, started.jobId);
    expect(telemetry.stage).toBe("object_stat");
    expect(telemetry.provider).toBe("r2");
    expect(telemetry.errorClass).toBe("TypeError");
    expect(telemetry.workflow).toBe("new_development");
    expect(telemetry.attempt).toBeGreaterThan(0);
  });

  it("records provider_resolution when the storage plane cannot be built", async () => {
    const world = nodeR2World();
    const started = await startCoralinaEquivalent(world);
    await uploadAllViaTransport(world, started.uploads);
    world.flags.r2Unavailable = true;

    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.errorCode).toBe("storage_provider_unavailable");
    expect(telemetryOf(world, started.jobId).stage).toBe("provider_resolution");
  });

  it("(11) carries ONLY allowlisted values — no filename, key, URL or credential", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);
    await uploadAllViaTransport(world, started.uploads);
    // Everything a careless implementation might carry through, in one message.
    const restore = world.workerR2.failBinding(
      "private_source",
      "head",
      () =>
        new TypeError(
          `GET https://acct.r2.cloudflarestorage.com/${TEST_R2_BUCKETS.privateSources}/` +
            `studio/jobs/${started.jobId}/staging/000/object` +
            `?X-Amz-Credential=AKIAEXAMPLE&X-Amz-Signature=deadbeef failed for material-01.jpg`,
        ),
    );

    const result = await withWorkerRuntime(world.workerR2.env, () =>
      processUploadJob(world.deps, OWNER, started.jobId),
    );
    restore();

    const job = world.data.jobs.get(started.jobId)!;
    const telemetry = telemetryOf(world, started.jobId);
    expect(Object.keys(telemetry).sort()).toEqual([...STUDIO_STAGE_TELEMETRY_KEYS].sort());

    const persisted = JSON.stringify({
      telemetry,
      errorCode: job.error_code,
      error: job.error,
      result: result.error,
    });
    for (const forbidden of [
      started.jobId,
      OWNER.userId,
      "material-01.jpg",
      "staging/000/object",
      TEST_R2_BUCKETS.privateSources,
      "r2.cloudflarestorage.com",
      "X-Amz-Signature",
      "X-Amz-Credential",
      "AKIAEXAMPLE",
      "deadbeef",
    ]) {
      expect(persisted, `telemetry must not contain ${forbidden}`).not.toContain(forbidden);
    }
    // And every value is a bounded primitive, never a nested object.
    for (const value of Object.values(telemetry)) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
  });
});

// ---------------------------------------------------------------------------
// 12, 13, 14 — bounded automatic retries
// ---------------------------------------------------------------------------

/** Drive automatic attempts against a job that fails deterministically. */
async function failAutomatically(world: FakeWorld, jobId: string, times: number): Promise<void> {
  const restore = world.workerR2.failBinding("private_source", "head");
  try {
    for (let attempt = 0; attempt < times; attempt += 1) {
      const stored = world.data.jobs.get(jobId)!;
      // Re-open the DATABASE gate between attempts, so the loop is never
      // stopped by `retryable = false` — the application cap is what this test
      // is about, and it has to hold on its own.
      stored.retryable = true;
      stored.status = "failed";
      await withWorkerRuntime(world.workerR2.env, () => resumeDueJobs(world.deps, OWNER));
    }
  } finally {
    restore();
  }
}

describe("bounded automatic retries", () => {
  it("(12) stops automatic attempts at the cap and marks the job non-retryable", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);
    await uploadAllViaTransport(world, started.uploads);
    const stored = world.data.jobs.get(started.jobId)!;
    stored.processing_requested_at = world.flags.nowValue;

    await failAutomatically(world, started.jobId, STUDIO_AUTOMATIC_RETRY_LIMIT);

    const job = await world.deps.data.getJob(started.jobId);
    expect(automaticFailureCount(job!)).toBe(STUDIO_AUTOMATIC_RETRY_LIMIT);
    expect(job?.retryable).toBe(false);
    expect(job?.status).toBe("failed");
    // The failure stays fully visible and fully truthful.
    expect(job?.error_code).toBe("object_stat_failed");
    expect(job?.attempt_count).toBeGreaterThanOrEqual(STUDIO_AUTOMATIC_RETRY_LIMIT);
    // The private originals are untouched: nothing was deleted to "clean up".
    expect(privateSourceKeys(world)).toHaveLength(6);
    expect(world.executor.store.projects).toHaveLength(0);
  });

  it("(13) the scheduler stops selecting a capped job, without touching it", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);
    await uploadAllViaTransport(world, started.uploads);
    const stored = world.data.jobs.get(started.jobId)!;
    stored.processing_requested_at = world.flags.nowValue;
    await failAutomatically(world, started.jobId, STUDIO_AUTOMATIC_RETRY_LIMIT);

    // Even with the database gate re-opened, the cap holds the automatic lane.
    const capped = world.data.jobs.get(started.jobId)!;
    capped.retryable = true;
    capped.status = "failed";
    const attemptsBefore = capped.attempt_count;
    world.workerR2.reset();

    const tick = await withWorkerRuntime(world.workerR2.env, () =>
      runScheduledStudioTick(world.deps, {}),
    );
    const resumed = await withWorkerRuntime(world.workerR2.env, () =>
      resumeDueJobs(world.deps, OWNER),
    );

    expect(tick.advanced).toBe(0);
    expect(tick.published).toBe(0);
    expect(resumed.resumed).toBe(0);
    const after = world.data.jobs.get(started.jobId)!;
    expect(after.attempt_count).toBe(attemptsBefore);
    expect(after.status).toBe("failed");
    // Not claimed, not read, not written.
    expect(world.workerR2.calls).toEqual([]);
  });

  it("(14, 15) an explicit controlled recovery still publishes — with no re-upload", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);
    await uploadAllViaTransport(world, started.uploads);
    const stored = world.data.jobs.get(started.jobId)!;
    stored.processing_requested_at = world.flags.nowValue;
    await failAutomatically(world, started.jobId, STUDIO_AUTOMATIC_RETRY_LIMIT);

    const capped = world.data.jobs.get(started.jobId)!;
    const historicalAttempts = capped.attempt_count;
    // The one authorized production action the corrected code needs: the
    // single-row recovery flip. Nothing here resets `attempt_count`.
    capped.retryable = true;
    capped.status = "failed";
    const objectsBefore = privateSourceKeys(world).slice().sort();
    world.workerR2.reset();

    const result = await withWorkerRuntime(world.workerR2.env, () =>
      processUploadJob(world.deps, OWNER, started.jobId),
    );

    expect(result.status).toBe("published");
    const job = await world.deps.data.getJob(started.jobId);
    // History preserved: the attempt count only ever went UP. Nothing here
    // reset it, zeroed it, or rewrote it to make the recovery look cleaner.
    expect(job!.attempt_count).toBeGreaterThan(historicalAttempts);
    expect(job!.attempt_count).toBeGreaterThanOrEqual(STUDIO_AUTOMATIC_RETRY_LIMIT + 1);
    // The SAME six objects were read. Nothing was re-uploaded and nothing new
    // appeared in the private bucket.
    expect(privateSourceKeys(world).slice().sort()).toEqual(objectsBefore);
    expect(world.workerR2.serverFetchAttempts).toEqual([]);
    expect(world.executor.store.projects).toHaveLength(1);
  });

  it("(14) a FAILED controlled attempt hands a fresh budget back to the automatic lane", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);
    await uploadAllViaTransport(world, started.uploads);
    const stored = world.data.jobs.get(started.jobId)!;
    stored.processing_requested_at = world.flags.nowValue;
    await failAutomatically(world, started.jobId, STUDIO_AUTOMATIC_RETRY_LIMIT);
    expect(automaticFailureCount(world.data.jobs.get(started.jobId)!)).toBe(
      STUDIO_AUTOMATIC_RETRY_LIMIT,
    );

    const capped = world.data.jobs.get(started.jobId)!;
    capped.retryable = true;
    capped.status = "failed";
    const restore = world.workerR2.failBinding("private_source", "head");
    const result = await withWorkerRuntime(world.workerR2.env, () =>
      processUploadJob(world.deps, OWNER, started.jobId),
    );
    restore();

    // The controlled attempt was accepted despite the cap, and it failed
    // honestly — but the Owner's decision restored the automatic budget.
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("object_stat_failed");
    const job = world.data.jobs.get(started.jobId)!;
    expect(automaticFailureCount(job)).toBe(0);
    expect((job.facts as Record<string, unknown>)[JOB_RETRY_FACTS_KEY]).toEqual({
      automaticFailures: 0,
    });
    expect(job.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 15–20 — recovering the existing failed job
// ---------------------------------------------------------------------------

describe("an existing failed R2 job recovers without re-upload", () => {
  it("(15–20) publishes from the bytes already in R2, on the binding plane", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);
    await uploadAllViaTransport(world, started.uploads);

    // Reproduce the contained production state: a job that failed at the very
    // first server-side object check, every file still `declared`, nothing
    // published, and no browser File object anywhere in the process.
    const restore = world.workerR2.failBinding("private_source", "head");
    const failed = await withWorkerRuntime(world.workerR2.env, () =>
      processUploadJob(world.deps, OWNER, started.jobId),
    );
    restore();
    expect(failed.status).toBe("failed");
    expect(failed.errorCode).toBe("object_stat_failed");
    const beforeRecovery = world.data.jobs.get(started.jobId)!;
    expect(beforeRecovery.files.every((file) => file.status === "declared")).toBe(true);
    expect(world.executor.store.projects).toHaveLength(0);

    const objectsBefore = privateSourceKeys(world).slice().sort();
    expect(objectsBefore).toHaveLength(6);
    beforeRecovery.retryable = true;
    world.workerR2.reset();

    // The recovery attempt. Corrected code, same job, same manifest, same six
    // objects — and no upload of any kind.
    const recovered = await withWorkerRuntime(world.workerR2.env, () =>
      processUploadJob(world.deps, OWNER, started.jobId),
    );

    expect(recovered.status).toBe("published");
    // (15) No re-upload: the private bucket is byte-identical in membership,
    // and every write the binding performed went to PUBLIC media.
    expect(privateSourceKeys(world).slice().sort()).toEqual(objectsBefore);
    expect(
      world.workerR2.calls.filter((c) => c.op === "put").every((c) => c.kind === "public_media"),
    ).toBe(true);
    // Provider stayed r2 throughout.
    const job = await world.deps.data.getJob(started.jobId);
    expect((job!.facts as { storage?: { provider?: string } }).storage?.provider).toBe("r2");
    // (17) Exactly one project, created once.
    expect(world.executor.store.projects).toHaveLength(1);
    expect(world.data.jobs.size).toBe(1);
    // (18) Supabase Storage received zero objects.
    expect(world.storage.objects.size).toBe(0);
    // (19, 20) Three JPEG derivatives are public; the three PDFs are not.
    const publicKeys = publicMediaKeys(world);
    expect(publicKeys.length).toBeGreaterThanOrEqual(3);
    expect(publicKeys.every((key) => key.startsWith("media/"))).toBe(true);
    // Exactly the three project photographs became page media. The Brochure,
    // the Price List and the Developer Profile did not: they are retained
    // privately, which is the material-purpose contract, unchanged.
    const media = world.executor.store.media;
    expect(media).toHaveLength(3);
    for (const row of media) {
      expect(row.url.startsWith(`${TEST_PUBLIC_MEDIA_ORIGIN}/media/`)).toBe(true);
      expect(row.url).not.toMatch(/\.pdf$/i);
    }
    // And nothing PDF-shaped reached the public bucket at all.
    expect(publicKeys.some((key) => key.startsWith("media/d/"))).toBe(false);
    // Re-running the recovery is a read, not a second publication.
    const again = await withWorkerRuntime(world.workerR2.env, () =>
      processUploadJob(world.deps, OWNER, started.jobId),
    );
    expect(again.status).toBe("published");
    expect(world.executor.store.projects).toHaveLength(1);
  });

  it("(16) the manifest really is the six-file Coralina equivalent", async () => {
    const world = workerWorld();
    const started = await startCoralinaEquivalent(world);
    const job = world.data.jobs.get(started.jobId)!;

    expect(job.files).toHaveLength(6);
    expect(job.files.map((file) => file.materialPurpose)).toEqual([
      "project_photo",
      "project_photo",
      "project_photo",
      "brochure",
      "price_list",
      "developer_profile",
    ]);
    expect(job.files.filter((file) => file.materialPurpose === "payment_plan")).toHaveLength(0);
    expect(job.files.filter((file) => file.materialPurpose === "project_archive")).toHaveLength(0);
    expect(job.files.every((file) => file.storageProvider === "r2")).toBe(true);
    // Three JPEGs then three PDFs, in the pilot's order.
    expect(job.files.map((file) => file.name.split(".").pop())).toEqual([
      "jpg",
      "jpg",
      "jpg",
      "pdf",
      "pdf",
      "pdf",
    ]);
    expect(magicBytesFor("material-01.jpg").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(magicBytesFor("material-04.pdf").subarray(0, 4).toString()).toBe("%PDF");
  });
});

// ---------------------------------------------------------------------------
// The archive control plane — refused loudly rather than silently broken
// ---------------------------------------------------------------------------

describe("the multipart archive control plane on a Worker", () => {
  it("refuses with a specific stage-labelled code instead of a generic fetch failure", async () => {
    const world = workerWorld();
    const provider = world.deps.storageProviders.get("r2");
    const geometry = {
      jobId: "00000000-0000-4000-8000-000000000001",
      archiveId: "00000000-0000-4000-8000-000000000002",
      declaredSize: 1024,
      partSize: 512,
      partCount: 2,
    };

    await expect(provider.beginArchiveUpload(geometry)).rejects.toMatchObject({
      code: "archive_control_plane_unavailable",
      stage: "archive_control_plane",
      retryable: false,
    });
    await expect(
      provider.listAcceptedArchiveParts({
        geometry,
        state: { provider: "r2", objectKey: "archives/x/y/archive.zip", multipartUploadId: "u" },
      }),
    ).rejects.toMatchObject({ stage: "archive_control_plane" });
    // It never even attempted the S3 request that cannot work.
    expect(world.workerR2.serverFetchAttempts).toEqual([]);
  });

  it("still reads a COMPLETED archive through the archives binding", async () => {
    const world = workerWorld();
    const provider = world.deps.storageProviders.get("r2");
    const geometry = {
      jobId: "00000000-0000-4000-8000-000000000001",
      archiveId: "00000000-0000-4000-8000-000000000002",
      declaredSize: 8,
      partSize: 8,
      partCount: 1,
    };
    const objectPath = `archives/${geometry.jobId}/${geometry.archiveId}/archive.zip`;
    world.r2.objects.set(`${TEST_R2_BUCKETS.projectArchives}/studio/${objectPath}`, {
      body: Buffer.from("ZIPBYTES"),
      contentType: "application/zip",
      etag: "x",
    });
    world.workerR2.reset();

    const reader = provider.archiveReader({
      geometry,
      state: { provider: "r2", objectKey: objectPath, completed: true },
      totalSize: 8,
    });
    const bytes = await reader.read(0, 8);

    expect(bytes.toString()).toBe("ZIPBYTES");
    expect(world.workerR2.callsFor("project_archives").some((c) => c.op === "get")).toBe(true);
    expect(world.workerR2.serverFetchAttempts).toEqual([]);
  });

  it("keeps the full multipart lifecycle working off a Worker", async () => {
    const world = nodeR2World();
    const provider = world.deps.storageProviders.get("r2");
    const geometry = {
      jobId: "00000000-0000-4000-8000-000000000001",
      archiveId: "00000000-0000-4000-8000-000000000002",
      declaredSize: 16,
      partSize: 8,
      partCount: 2,
    };

    const state = await provider.beginArchiveUpload(geometry);

    expect(state.multipartUploadId).toBeTruthy();
    const targets = await provider.archivePartTargets({ geometry, state, indexes: [0, 1] });
    expect(targets).toHaveLength(2);
    // ListParts — the resume authority — is reachable off a Worker.
    await expect(provider.listAcceptedArchiveParts({ geometry, state })).resolves.toBeInstanceOf(
      Map,
    );
  });
});
