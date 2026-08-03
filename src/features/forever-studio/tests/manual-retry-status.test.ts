import { describe, expect, it } from "vitest";

import { getUploadJobStatus, startUploadJob } from "../server/service";
import { makeWorld, OWNER } from "./fakes";

describe("exact-job manual Retry observation endpoint", () => {
  it("is read-only and reports the true attempt count and safe stage", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Read-only observation" },
      files: [],
    });
    const job = world.data.jobs.get(started.jobId)!;
    job.status = "failed";
    job.error_code = "object_stat_failed";
    job.error = "Forever could not confirm the uploaded files in storage.";
    job.attempt_count = 7;
    job.facts = {
      ...job.facts,
      processing: {
        provider: "r2",
        stage: "object_stat",
        code: "object_stat_failed",
        errorClass: "transport",
        attempt: 7,
        retryable: true,
        workflow: "new_development",
      },
    };
    const before = JSON.stringify(job);

    const first = await getUploadJobStatus(world.deps, OWNER, started.jobId);
    const second = await getUploadJobStatus(world.deps, OWNER, started.jobId);

    expect(first).toEqual(second);
    expect(first.status).toBe("failed");
    expect(first.attemptCount).toBe(7);
    expect(first.errorCode).toBe("object_stat_failed");
    expect(first.errorStage).toBe("object_stat");
    expect(JSON.stringify(world.data.jobs.get(started.jobId))).toBe(before);
  });

  it("projects no facts, file manifest, object key, filename, or raw exception", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Bounded projection" },
      files: [],
    });
    const job = world.data.jobs.get(started.jobId)!;
    job.status = "failed";
    job.error_code = "object_read_failed";
    job.error = "The stored object could not be read safely.";
    job.facts = {
      privateObjectKey: "never/projected/private/key",
      processing: {
        provider: "r2",
        stage: "object_read",
        code: "object_read_failed",
        errorClass: "transport",
        attempt: 1,
        retryable: true,
        workflow: "new_development",
      },
    };
    job.files = [
      {
        name: "private-material.pdf",
        stagingBucket: "private",
        stagingPath: "private/object/key",
        storageProvider: "r2",
      } as never,
    ];

    const observed = await getUploadJobStatus(world.deps, OWNER, started.jobId);
    const serialized = JSON.stringify(observed);

    expect(observed.errorStage).toBe("object_read");
    expect(serialized).not.toContain("private-material.pdf");
    expect(serialized).not.toContain("private/object/key");
    expect(serialized).not.toContain("privateObjectKey");
    expect(serialized).not.toContain("files");
    expect(serialized).not.toContain("facts");
  });

  it("stops safely when the exact job is missing", async () => {
    const world = makeWorld();
    await expect(
      getUploadJobStatus(world.deps, OWNER, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ name: "job_not_found", retryable: false });
  });
});
