import { describe, expect, it, vi } from "vitest";

import { getOverview, processUploadJob, resumeDueJobs, startUploadJob } from "../server/service";
import { makeWorld, OWNER, PUBLISHER } from "./fakes";

function snapshotWorld(world: ReturnType<typeof makeWorld>): string {
  return JSON.stringify({
    jobs: [...world.data.jobs],
    store: world.executor.store,
    listings: world.data.listings,
    contacts: [...world.data.contacts],
    warnings: world.data.listingWarnings,
    owners: [...world.data.objectOwners],
    audits: world.data.audits,
    objects: [...world.storage.objects].map(([key, value]) => [key, value.toString("hex")]),
    contentTypes: [...world.storage.contentTypes],
    tokenSeq: world.flags.tokenSeq,
  });
}

async function makeStale(
  world: ReturnType<typeof makeWorld>,
  actor: typeof OWNER | typeof PUBLISHER,
  name: string,
): Promise<string> {
  const started = await startUploadJob(world.deps, actor, {
    workflow: "new_development",
    projectFacts: { name },
    files: [],
  });
  await world.data.requestJobProcessing(started.jobId, `dead-${started.jobId}`, 900);
  return started.jobId;
}

describe("durable resume eligibility", () => {
  it("counts and resumes an old eligible job outside the 25-row history slice", async () => {
    const world = makeWorld();
    const oldJobId = await makeStale(world, OWNER, "Old resumable project");
    world.advanceMinutes(20);

    for (let index = 0; index < 25; index += 1) {
      const newer = await startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: `Newer completed project ${index}` },
        files: [],
      });
      expect((await processUploadJob(world.deps, OWNER, newer.jobId)).status).toBe("published");
      world.advanceMinutes(1);
    }

    const overview = await getOverview(world.deps, OWNER);
    expect(overview.jobs).toHaveLength(25);
    expect(overview.jobs.map((job) => job.id)).not.toContain(oldJobId);
    expect(overview.activeJobs).toBe(1);

    // Mirrors StudioDashboard: an independently calculated active count keeps
    // the resume endpoint and polling alive even when history omits the job.
    if (overview.activeJobs > 0) await resumeDueJobs(world.deps, OWNER);
    expect((await world.data.getJob(oldJobId))?.status).toBe("published");
  });

  it("skips a disabled-source due job and publishes the active-source job behind it", async () => {
    const world = makeWorld();
    const disabledJobId = await makeStale(world, PUBLISHER, "Disabled source project");
    const activeJobId = await makeStale(world, OWNER, "Active source project");
    world.advanceMinutes(20);
    world.data.members.find((row) => row.user_id === PUBLISHER.userId)!.is_active = false;
    const disabledBefore = snapshotWorld(world);

    const resumed = await resumeDueJobs(world.deps, OWNER);

    expect(resumed.results.map((result) => result.jobId)).toEqual([activeJobId]);
    expect(resumed.resumed).toBe(1);
    const disabledAfter = JSON.parse(snapshotWorld(world));
    const before = JSON.parse(disabledBefore);
    expect(disabledAfter.jobs.find(([id]: [string]) => id === disabledJobId)).toEqual(
      before.jobs.find(([id]: [string]) => id === disabledJobId),
    );
    expect((await world.data.getJob(disabledJobId))?.status).toBe("processing");
  });

  it("finds a valid job behind more than five missing-source jobs", async () => {
    const world = makeWorld();
    const disabledIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      disabledIds.push(await makeStale(world, PUBLISHER, `Missing source ${index}`));
    }
    const activeJobId = await makeStale(world, OWNER, "Valid job after invalid sources");
    world.advanceMinutes(20);
    world.data.members = world.data.members.filter((row) => row.user_id !== PUBLISHER.userId);
    const before = snapshotWorld(world);

    const resumed = await resumeDueJobs(world.deps, OWNER);

    expect(resumed.results.map((result) => result.jobId)).toEqual([activeJobId]);
    expect(resumed.resumed).toBe(1);
    const beforeJobs = new Map(JSON.parse(before).jobs);
    for (const id of disabledIds) {
      expect([...world.data.jobs].find(([jobId]) => jobId === id)).toEqual(
        beforeJobs.get(id) ? [id, beforeJobs.get(id)] : undefined,
      );
    }
  });

  it("counts and resumes only the Publisher's own active-source jobs", async () => {
    const world = makeWorld();
    const publisherJobId = await makeStale(world, PUBLISHER, "Publisher active job");
    const ownerJobId = await makeStale(world, OWNER, "Owner active job");
    world.advanceMinutes(20);

    const overview = await getOverview(world.deps, PUBLISHER);
    expect(overview.activeJobs).toBe(1);
    const resumed = await resumeDueJobs(world.deps, PUBLISHER);

    expect(resumed.results.map((result) => result.jobId)).toEqual([publisherJobId]);
    expect((await world.data.getJob(ownerJobId))?.status).toBe("processing");
  });

  it("isolates a source disabled after selection so unrelated eligible jobs continue", async () => {
    const world = makeWorld();
    const publisherJobId = await makeStale(world, PUBLISHER, "Authorization race job");
    const ownerJobId = await makeStale(world, OWNER, "Unaffected eligible job");
    world.advanceMinutes(20);
    const originalList = world.data.listDueJobs.bind(world.data);
    vi.spyOn(world.data, "listDueJobs").mockImplementation(async (...args) => {
      const selected = await originalList(...args);
      world.data.members.find((row) => row.user_id === PUBLISHER.userId)!.is_active = false;
      return selected;
    });
    const beforePublisher = structuredClone(await world.data.getJob(publisherJobId));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const resumed = await resumeDueJobs(world.deps, OWNER);

    expect(resumed.results.map((result) => result.jobId)).toEqual([ownerJobId]);
    expect(await world.data.getJob(publisherJobId)).toEqual(beforePublisher);
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^\[studio\] automatic_resume_job_skipped:/),
    );
    error.mockRestore();
  });

  it("keeps exact resume retries idempotent", async () => {
    const world = makeWorld();
    const jobId = await makeStale(world, OWNER, "Idempotent durable retry");
    world.advanceMinutes(20);

    expect((await resumeDueJobs(world.deps, OWNER)).resumed).toBe(1);
    const afterFirst = snapshotWorld(world);
    expect(await resumeDueJobs(world.deps, OWNER)).toEqual({ resumed: 0, results: [] });
    expect(snapshotWorld(world)).toBe(afterFirst);
    expect((await world.data.getJob(jobId))?.status).toBe("published");
  });
});
