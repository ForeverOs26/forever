/**
 * FOREVER-R2-MEDIA-STORAGE-CUTOVER-001 — the ordinary direct-upload lane.
 *
 * Runs against the LOCAL, in-process, disposable S3-compatible harness, which
 * authenticates every request by recomputing the SigV4 signature with the same
 * signer production uses. Nothing here can reach production or staging R2 or
 * Supabase: no socket is opened at all.
 */

import { describe, expect, it } from "vitest";

import { processUploadJob, startUploadJob } from "../server/service";
import { assertLocalR2Endpoint, createLocalR2, LOCAL_R2_ENDPOINT } from "./local-r2";
import {
  enroll,
  magicBytesFor,
  makeWorld,
  OWNER,
  PUBLISHER,
  TEST_R2_BUCKETS,
  tinyPdf,
  uploadAllViaTransport,
  type FakeWorld,
} from "./fakes";

function r2World(): FakeWorld {
  const world = makeWorld();
  assertLocalR2Endpoint(world.r2.endpoint);
  world.flags.writeProvider = "r2";
  return world;
}

async function startPhotoJob(world: FakeWorld, name = "hero.jpg") {
  return startUploadJob(world.deps, OWNER, {
    workflow: "new_development",
    projectFacts: { name: "R2 Direct Upload" },
    files: [{ name, materialPurpose: "project_photo" }],
  });
}

describe("local R2 harness", () => {
  it("is in-process and refuses any non-local endpoint", async () => {
    const r2 = createLocalR2();
    expect(r2.endpoint).toBe(LOCAL_R2_ENDPOINT);
    expect(() => assertLocalR2Endpoint("https://accountid.r2.cloudflarestorage.com")).toThrow(
      /non-local endpoint/,
    );
    await expect(r2.fetchImpl("https://example.com/x", { method: "GET" })).rejects.toThrow(
      /non-local request/,
    );
  });

  it("refuses an unsigned request", async () => {
    const r2 = createLocalR2();
    const response = await r2.fetchImpl(`${LOCAL_R2_ENDPOINT}/bucket/key`, { method: "PUT" });
    expect(response.status).toBe(403);
  });
});

describe("allocation", () => {
  it("creates a server-generated, filename-free target for an authorized Owner", async () => {
    const world = r2World();
    const started = await startPhotoJob(world, "Owner Passport Scan.jpg");
    expect(started.uploads).toHaveLength(1);
    const [target] = started.uploads;
    expect(target.fileIndex).toBe(0);
    expect(target.transport?.kind).toBe("r2_presigned_put");
    // A presigned target carries no Supabase token at all.
    expect(target.token).toBeUndefined();
    expect(target.path).toBe(`jobs/${started.jobId}/staging/000/object`);
    expect(target.path.toLowerCase()).not.toContain("passport");
    // Allocation alone writes nothing.
    expect(world.r2.objects.size).toBe(0);
  });

  it("refuses an unauthorized request BEFORE any target is allocated", async () => {
    const world = r2World();
    enroll(world, PUBLISHER);
    // The Owner owns this project.
    const owned = await startPhotoJob(world);
    await uploadAllViaTransport(world, owned.uploads);
    await processUploadJob(world.deps, OWNER, owned.jobId);
    const requestsBefore = world.r2.requests.length;

    await expect(
      startUploadJob(world.deps, PUBLISHER, {
        workflow: "project_update",
        projectSlug: "r2-direct-upload",
        files: [{ name: "sneaky.jpg", materialPurpose: "project_photo" }],
      }),
    ).rejects.toThrow("studio_access_denied");

    // Not one presign, not one object: the refusal precedes allocation.
    expect(world.r2.requests.length).toBe(requestsBefore);
  });
});

describe("the presigned request is a single-object, single-method credential", () => {
  it("accepts the exact PUT it was signed for", async () => {
    const world = r2World();
    const started = await startPhotoJob(world);
    await uploadAllViaTransport(world, started.uploads);
    expect(
      world.r2.objects.has(
        `${TEST_R2_BUCKETS.privateSources}/studio/jobs/${started.jobId}/staging/000/object`,
      ),
    ).toBe(true);
  });

  it("refuses a different HTTP method on the same URL", async () => {
    const world = r2World();
    const started = await startPhotoJob(world);
    const transport = started.uploads[0].transport!;
    if (transport.kind !== "r2_presigned_put") throw new Error("expected an R2 transport");
    const response = await world.r2.fetchImpl(transport.url, {
      method: "GET",
      headers: transport.headers,
    });
    expect(response.status).toBe(403);
  });

  it("refuses a Content-Type other than the signed one", async () => {
    const world = r2World();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Signed Content Type" },
      files: [{ name: "hero.jpg", contentType: "image/jpeg", materialPurpose: "project_photo" }],
    });
    const transport = started.uploads[0].transport!;
    if (transport.kind !== "r2_presigned_put") throw new Error("expected an R2 transport");
    expect(transport.headers["content-type"]).toBe("image/jpeg");
    const response = await world.r2.fetchImpl(transport.url, {
      method: "PUT",
      headers: { "content-type": "text/html" },
      body: new Uint8Array([1, 2, 3]) as unknown as BodyInit,
    });
    expect(response.status).toBe(403);
    expect(world.r2.objects.size).toBe(0);
  });

  it("refuses a target whose object key was tampered with", async () => {
    const world = r2World();
    const started = await startPhotoJob(world);
    const transport = started.uploads[0].transport!;
    if (transport.kind !== "r2_presigned_put") throw new Error("expected an R2 transport");
    const tampered = transport.url.replace("/staging/000/", "/staging/001/");
    const response = await world.r2.fetchImpl(tampered, {
      method: "PUT",
      headers: transport.headers,
      body: new Uint8Array([1]) as unknown as BodyInit,
    });
    expect(response.status).toBe(403);
  });

  it("refuses an expired signature", async () => {
    const world = r2World();
    const started = await startPhotoJob(world);
    const transport = started.uploads[0].transport!;
    if (transport.kind !== "r2_presigned_put") throw new Error("expected an R2 transport");
    // Past the short presign lifetime.
    world.r2.advanceSeconds(3600);
    const response = await world.r2.fetchImpl(transport.url, {
      method: "PUT",
      headers: transport.headers,
      body: new Uint8Array([1]) as unknown as BodyInit,
    });
    expect(response.status).toBe(403);
    expect(world.r2.objects.size).toBe(0);
  });
});

describe("server-side verification of the ACTUAL stored bytes", () => {
  it("verifies size, SHA-256 and magic bytes, then publishes a derivative", async () => {
    const world = r2World();
    const bytes = magicBytesFor("hero.jpg");
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "R2 Byte Verification" },
      // A deliberately WRONG declared size: the stored bytes are authoritative.
      files: [{ name: "hero.jpg", size: 999_999, materialPurpose: "project_photo" }],
    });
    await uploadAllViaTransport(world, started.uploads, { "hero.jpg": bytes });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");

    const job = await world.deps.data.getJob(started.jobId);
    const file = job!.files[0];
    expect(file.observedSize).toBe(bytes.length);
    expect(file.declaredMismatch).toBe(true);
    expect(file.mediaClass).toBe("image");
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(file.status).toBe("published_public");
    expect(result.warnings.map((warning) => warning.code)).toContain("file_declared_size_mismatch");
  });

  it("keeps material whose bytes contradict the chosen window private", async () => {
    const world = r2World();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "R2 Class Mismatch" },
      files: [{ name: "hero.jpg", materialPurpose: "project_photo" }],
    });
    // A PDF uploaded through the Project Photos window.
    await uploadAllViaTransport(world, started.uploads, { "hero.jpg": tinyPdf() });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");
    expect(result.warnings.map((warning) => warning.code)).toContain("media_class_mismatch");
    // Nothing entered the public bucket, and the original is still private.
    expect(world.r2.keys(TEST_R2_BUCKETS.publicMedia)).toEqual([]);
    expect(world.r2.keys(TEST_R2_BUCKETS.privateSources).length).toBe(1);
  });

  it("never leaks the original filename into a warning", async () => {
    const world = r2World();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "R2 Warning Privacy" },
      files: [{ name: "Jane Smith Contract.jpg", materialPurpose: "project_photo" }],
    });
    await uploadAllViaTransport(world, started.uploads, {
      "Jane Smith Contract.jpg": tinyPdf(),
    });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    for (const warning of result.warnings) {
      expect(warning.message).not.toContain("Jane");
      expect(warning.message).not.toContain("Contract");
      expect(warning.message).not.toContain("studio/jobs/");
      expect(warning.message).not.toContain(TEST_R2_BUCKETS.privateSources);
    }
  });
});

describe("no credential ever reaches persistence, audit or a warning", () => {
  it("keeps signed URLs out of the job row, the archives and the audit log", async () => {
    const world = r2World();
    const started = await startPhotoJob(world);
    const transport = started.uploads[0].transport!;
    if (transport.kind !== "r2_presigned_put") throw new Error("expected an R2 transport");
    await uploadAllViaTransport(world, started.uploads);
    await processUploadJob(world.deps, OWNER, started.jobId);

    // Maps serialize as `{}`, so the VALUES are spread explicitly — otherwise
    // this assertion would pass by inspecting nothing.
    const persisted = JSON.stringify({
      jobs: [...world.data.jobs.values()],
      archives: [...world.data.archives.values()],
      audit: world.data.audits,
    });
    expect(persisted).toContain(started.jobId);
    expect(persisted).not.toContain("X-Amz-Signature");
    expect(persisted).not.toContain("X-Amz-Credential");
    expect(persisted).not.toContain(world.r2.credentials.secretAccessKey);
    expect(persisted).not.toContain(world.r2.credentials.accessKeyId);
    expect(persisted).not.toContain(LOCAL_R2_ENDPOINT);
    // The audit records the provider identity and nothing about how to reach it.
    const created = world.data.audits.find((row) => row.action === "studio_job_created");
    expect(created?.metadata.storage_provider).toBe("r2");
  });
});
