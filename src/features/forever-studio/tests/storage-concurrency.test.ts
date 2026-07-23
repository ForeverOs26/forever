/**
 * FOREVER-STUDIO-001 — claim-safe storage side effects, post-commit audit
 * safety, and lease behavior.
 *
 * Public media paths are processing-token-scoped, so a stale worker can never
 * overwrite or delete a newer claim's objects; cleanup is grouped by bucket;
 * the winner sweeps dead attempts' orphans after commit; an audit failure
 * after the committed publication never fails the result or removes media;
 * a terminal (retryable=false) job is never reclaimed; and the lease
 * heartbeat keeps a live long-running worker from being treated as dead.
 */

import { describe, expect, it, vi } from "vitest";

import {
  attemptPrefixFromToken,
  PUBLIC_DOCUMENT_BUCKET,
  PUBLIC_IMAGE_BUCKET,
} from "../server/extraction";
import {
  processClaimedJob,
  processUploadJob,
  resumeDueJobs,
  startUploadJob,
} from "../server/service";
import { makeWorld, tinyPdf, uploadAll, OWNER } from "./fakes";

describe("claim-scoped storage side effects", () => {
  it("copies public media onto token-scoped paths", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Scoped Paths" },
      files: [{ name: "photo.jpg" }],
    });
    uploadAll(world, started.uploads);
    await processUploadJob(world.deps, OWNER, started.jobId);

    const keys = world.storage.publicKeys(PUBLIC_IMAGE_BUCKET);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^studio/${started.jobId}/[a-zA-Z0-9]+/00-photo\\.jpg$`));
    const attempt = (await world.data.getJob(started.jobId))!.result_summary?.attempt;
    expect(typeof attempt).toBe("string");
    expect(keys[0]).toContain(`/${attempt}/`);
  });

  it("cleans up a failed attempt across MULTIPLE public buckets", async () => {
    const world = makeWorld();
    world.data.failAfterIngest = true;
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Mixed Buckets" },
      // photo → project-images; brochure PDF → project-documents.
      files: [{ name: "photo.jpg" }, { name: "brochure.pdf" }],
    });
    uploadAll(world, started.uploads, { "brochure.pdf": tinyPdf() });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("failed");
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(0);
    expect(world.storage.publicKeys(PUBLIC_DOCUMENT_BUCKET)).toHaveLength(0);
  });

  it("a stale worker can neither damage the winner's storage nor its metadata", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Stale Vs Winner" },
      files: [{ name: "photo.jpg" }],
    });
    uploadAll(world, started.uploads);

    // Worker A claims, then stalls (its request hangs but does not die).
    const staleClaim = await world.data.requestJobProcessing(started.jobId, "stale-A-token", 900);
    expect(staleClaim).not.toBeNull();

    // The claim goes stale; worker B recovers and publishes.
    world.advanceMinutes(20);
    const winner = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(winner.status).toBe("published");
    const winnerKeys = world.storage.publicKeys(PUBLIC_IMAGE_BUCKET);
    expect(winnerKeys).toHaveLength(1);
    const winnerJob = await world.data.getJob(started.jobId);
    const winnerFiles = JSON.stringify(winnerJob!.files);
    const winnerBytes = Buffer.from(
      world.storage.objects.get(`${PUBLIC_IMAGE_BUCKET}/${winnerKeys[0]}`)!,
    );

    // Worker A wakes up and keeps going with its LOST claim.
    const staleResult = await processClaimedJob(world.deps, OWNER, staleClaim!, "stale-A-token");

    // A's continuation reports the job's true (published) state...
    expect(staleResult.status).toBe("published");
    // ...the winner's public object survives byte-for-byte at the same path...
    const keysAfter = world.storage.publicKeys(PUBLIC_IMAGE_BUCKET);
    expect(keysAfter).toEqual(winnerKeys);
    expect(
      winnerBytes.equals(world.storage.objects.get(`${PUBLIC_IMAGE_BUCKET}/${winnerKeys[0]}`)!),
    ).toBe(true);
    // ...the winner's job metadata is untouched (claim-checked update)...
    const jobAfter = await world.data.getJob(started.jobId);
    expect(JSON.stringify(jobAfter!.files)).toBe(winnerFiles);
    expect(jobAfter!.result_summary?.attempt).toBe(winnerJob!.result_summary?.attempt);
    // ...and A's own token-scoped copies were removed (no public orphans).
    expect(
      keysAfter.some((key) => key.includes(`/${attemptPrefixFromToken("stale-A-token")}/`)),
    ).toBe(false);
  });

  it("the winner sweeps a crashed attempt's public orphans after commit", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Crash Orphans" },
      files: [{ name: "photo.jpg" }],
    });
    uploadAll(world, started.uploads);

    // Attempt 1 uploads its derivative, then crashes between the public upload and
    // the database commit — cleanup also dies (failRemoveOnce), leaving a
    // public orphan under attempt 1's token prefix.
    world.data.failAfterIngest = true;
    world.storage.failRemoveOnce = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const crashed = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(crashed.status).toBe("failed");
    const orphans = world.storage.publicKeys(PUBLIC_IMAGE_BUCKET);
    expect(orphans).toHaveLength(1); // the orphan is really there

    // The retry succeeds; the winner's sweep removes the dead attempt's
    // orphan and only the winner's object remains.
    world.data.failAfterIngest = false;
    const retried = await processUploadJob(world.deps, OWNER, started.jobId);
    spy.mockRestore();
    expect(retried.status).toBe("published");
    const finalKeys = world.storage.publicKeys(PUBLIC_IMAGE_BUCKET);
    expect(finalKeys).toHaveLength(1);
    expect(finalKeys[0]).not.toBe(orphans[0]);
    const attempt = (await world.data.getJob(started.jobId))!.result_summary?.attempt;
    expect(finalKeys[0]).toContain(`/${attempt}/`);
  });
});

describe("audit failure after a committed publication", () => {
  it("still returns success and keeps the page, media, and job state intact", async () => {
    const world = makeWorld();
    world.data.failAudit = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Audit Outage Project" },
      files: [{ name: "photo.jpg" }],
    });
    uploadAll(world, started.uploads);
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    // The user-visible result is SUCCESS — the publication committed.
    expect(result.status).toBe("published");
    expect(result.errorCode).toBeNull();
    // Nothing was rolled back or deleted because of the audit outage.
    expect(world.executor.publicProjects()).toHaveLength(1);
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(1);
    expect((await world.data.getJob(started.jobId))?.status).toBe("published");
    // The diagnostic was logged server-side, redacted.
    const logged = spy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("audit_write_failed");
    expect(logged).not.toContain("/var/db");
    expect(logged).not.toContain("postgres://user");
    spy.mockRestore();

    // A later re-entry is a read of the same success, not a retry.
    world.data.failAudit = false;
    const again = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(again.status).toBe("published");
    expect(world.executor.store.batches).toHaveLength(1);
  });

  it("resale: audit outage after commit is equally non-destructive", async () => {
    const world = makeWorld();
    world.data.failAudit = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "resale_listing",
      resaleFacts: { title: "Audit Outage Resale", contactPhone: "+66 1" },
      files: [{ name: "photo.jpg" }],
    });
    uploadAll(world, started.uploads);
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    spy.mockRestore();

    expect(result.status).toBe("published");
    expect(world.data.publicListings()).toHaveLength(1);
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(1);
  });
});

describe("terminal failures and the processing lease", () => {
  it("never reclaims a retryable=false job — claim and resume agree", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Terminal Project" },
      files: [],
    });
    const claim = await world.data.requestJobProcessing(started.jobId, "t1", 900);
    expect(claim).not.toBeNull();
    await world.data.failJob({
      jobId: started.jobId,
      token: "t1",
      errorCode: "processing_failed",
      message: "terminal",
      retryable: false,
    });

    // The database claim refuses it…
    expect(await world.data.claimJob(started.jobId, "t2", 900)).toBeNull();
    // …automatic resume never lists it…
    expect((await resumeDueJobs(world.deps, OWNER)).results).toHaveLength(0);
    // …and a manual poke reads the failed state without reprocessing.
    const attempts = (await world.data.getJob(started.jobId))!.attempt_count;
    const poked = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(poked.status).toBe("failed");
    expect(poked.retryable).toBe(false);
    expect((await world.data.getJob(started.jobId))!.attempt_count).toBe(attempts);
  });

  it("a heartbeat keeps a live lease from being stolen; silence lets it go stale", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Lease Project" },
      files: [],
    });
    await world.data.requestJobProcessing(started.jobId, "live-worker", 900);

    // 10 minutes in, the worker is alive and heartbeats.
    world.advanceMinutes(10);
    expect(await world.data.heartbeatJob(started.jobId, "live-worker")).toBe(true);
    // 10 more minutes: 20 since claim, but only 10 since the heartbeat —
    // the lease is fresh and cannot be stolen.
    world.advanceMinutes(10);
    expect(await world.data.claimJob(started.jobId, "thief", 900)).toBeNull();
    // The worker goes silent past the stale interval: recoverable.
    world.advanceMinutes(16);
    expect(await world.data.claimJob(started.jobId, "recovery", 900)).not.toBeNull();
    // The old worker's heartbeat now reports the lost claim (it must stop).
    expect(await world.data.heartbeatJob(started.jobId, "live-worker")).toBe(false);
  });
});
