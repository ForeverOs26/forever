/**
 * FOREVER-STUDIO-001 — automatic durable resume (item 7).
 *
 * Only jobs that crossed the explicit processing boundary complete without
 * the browser. Pristine received jobs are inert; retryable-failed and stale-
 * processing ready jobs resume without duplicate publication.
 */

import { describe, expect, it } from "vitest";

import { processUploadJob, resumeDueJobs, startUploadJob } from "../server/service";
import { makeWorld, uploadAll, OWNER, PUBLISHER } from "./fakes";

describe("automatic durable resume", () => {
  it("leaves a pristine received job inert until processing is explicitly requested", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Closed Browser Project" },
      files: [{ name: "photo.jpg" }],
    });
    uploadAll(world, started.uploads);
    // Uploaded bytes alone are not proof that the browser finished the full
    // upload set, so closing before processJob leaves the job inert.
    const resumed = await resumeDueJobs(world.deps, OWNER);
    expect(resumed).toEqual({ resumed: 0, results: [] });
    expect(world.executor.publicProjects()).toHaveLength(0);
    expect((await world.data.getJob(started.jobId))?.processing_requested_at).toBeNull();

    const processed = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(processed.status).toBe("published");
    expect(world.executor.publicProjects()).toHaveLength(1);
  });

  it("recovers a stale-processing job after its claim goes cold", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Stale Project" },
      files: [],
    });
    // A worker claims the job then dies (leaves it 'processing').
    await world.data.requestJobProcessing(started.jobId, "dead-worker", 900);
    // Not yet stale → nothing due.
    expect((await resumeDueJobs(world.deps, OWNER)).resumed).toBe(0);
    // Time passes; the claim goes stale and is recoverable.
    world.advanceMinutes(20);
    const resumed = await resumeDueJobs(world.deps, OWNER);
    expect(resumed.resumed).toBe(1);
    expect((await world.data.getJob(started.jobId))?.status).toBe("published");
  });

  it("retries a retryable-failed job automatically", async () => {
    const world = makeWorld();
    world.data.failAfterIngest = true;
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Auto Retry Project" },
      files: [],
    });
    const first = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(first.status).toBe("failed");

    world.data.failAfterIngest = false;
    const second = await resumeDueJobs(world.deps, OWNER);
    expect(second.resumed).toBe(1);
    expect(world.executor.store.projects).toHaveLength(1);
  });

  it("resume is a no-op under Partner Demo mode", async () => {
    const world = makeWorld();
    await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "X" },
      files: [],
    });
    world.flags.partnerDemo = true;
    expect((await resumeDueJobs(world.deps, OWNER)).resumed).toBe(0);
  });

  it("a publisher only resumes their own jobs; the owner resumes any", async () => {
    const world = makeWorld();
    const ownerJob = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Owner Job" },
      files: [],
    });
    await world.data.requestJobProcessing(ownerJob.jobId, "dead-owner-worker", 900);
    world.advanceMinutes(20);
    // Publisher resume should not touch the owner's job.
    const publisherView = await resumeDueJobs(world.deps, PUBLISHER);
    expect(publisherView.results.every((r) => r.jobId !== ownerJob.jobId)).toBe(true);
    expect((await world.data.getJob(ownerJob.jobId))?.status).toBe("processing");
    // Owner resume completes it.
    const ownerView = await resumeDueJobs(world.deps, OWNER);
    expect(ownerView.resumed).toBe(1);
  });
});
