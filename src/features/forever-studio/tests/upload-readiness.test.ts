import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { processUploadJob, resumeDueJobs, startUploadJob } from "../server/service";
import { makeWorld, tinyJpeg, OWNER } from "./fakes";

function largeJpeg(totalBytes = 26 * 1024 * 1024): Buffer {
  const head = tinyJpeg();
  return Buffer.concat([head, Buffer.alloc(totalBytes - head.length, 0x42)]);
}

describe("explicit upload-complete readiness boundary", () => {
  it("does not strand a late file when another dashboard polls during a slow 26 MiB upload", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Slow Complete Upload" },
      files: [{ name: "large.jpg" }, { name: "late.jpg" }],
    });
    world.storage.put(started.uploads[0].bucket, started.uploads[0].path, largeJpeg(), "text/html");

    // A second dashboard may poll any number of times while the first browser
    // is still uploading. The pristine received manifest must stay inert.
    for (let poll = 0; poll < 3; poll += 1) {
      expect(await resumeDueJobs(world.deps, OWNER)).toEqual({ resumed: 0, results: [] });
    }
    expect((await world.data.getJob(started.jobId))?.processing_requested_at).toBeNull();
    expect(world.executor.store.projects).toHaveLength(0);

    world.storage.put(
      started.uploads[1].bucket,
      started.uploads[1].path,
      Buffer.concat([tinyJpeg(), Buffer.from("late")]),
      "text/html",
    );
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");
    expect(result.warnings.some((warning) => warning.code === "media_sanitization_limit")).toBe(
      true,
    );
    expect(world.executor.store.media).toHaveLength(1);
    const files = (await world.data.getJob(started.jobId))!.files;
    expect(files.find((file) => file.name === "late.jpg")?.status).toBe("published_public");
    expect(files.find((file) => file.name === "large.jpg")?.publicPath).toBeUndefined();
    expect((await world.data.getJob(started.jobId))?.processing_requested_at).not.toBeNull();
  });

  it("uses the same explicit boundary for a zero-file upload", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Zero File Boundary" },
      files: [],
    });
    expect(await resumeDueJobs(world.deps, OWNER)).toEqual({ resumed: 0, results: [] });
    expect((await world.data.getJob(started.jobId))?.processing_requested_at).toBeNull();

    expect((await processUploadJob(world.deps, OWNER, started.jobId)).status).toBe("published");
    expect((await processUploadJob(world.deps, OWNER, started.jobId)).status).toBe("published");
    expect(world.executor.store.projects).toHaveLength(1);
  });

  it("keeps duplicate process requests idempotent while a fresh worker owns the claim", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Duplicate Readiness Request" },
      files: [],
    });
    expect(
      await world.data.requestJobProcessing(started.jobId, "first-live-worker", 900),
    ).toMatchObject({ status: "processing" });

    const duplicate = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(duplicate.status).toBe("processing");
    expect(world.executor.store.projects).toHaveLength(0);

    world.advanceMinutes(20);
    expect((await resumeDueJobs(world.deps, OWNER)).resumed).toBe(1);
    expect(world.executor.store.projects).toHaveLength(1);
    expect((await processUploadJob(world.deps, OWNER, started.jobId)).status).toBe("published");
    expect(world.executor.store.projects).toHaveLength(1);
  });

  it("tells users the truth before and after server-confirmed readiness", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/forever-studio/components/StudioUploader.tsx"),
      "utf8",
    );
    expect(source).toContain("Keep this page open until every file finishes");
    expect(source).toContain("Closing now leaves the upload private");
    expect(source).toContain("Processing request confirmed");
    expect(source).toContain("You can safely close this page");
    expect(source).not.toContain(
      "You can safely close this page — publishing continues on the server",
    );
  });
});
