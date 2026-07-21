/**
 * FOREVER-STUDIO-001 — private staging + byte verification (items 4 & 5).
 *
 * Every file lands in private staging; the actual bytes are verified (size,
 * sha256, media class, declared-vs-observed); only selected, byte-matching
 * final media are copied to public buckets; a failed job exposes no public
 * object; oversized business files are retained, never blocking; and forged
 * media declarations are rejected.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_PARSE_BYTES,
  PRIVATE_SOURCE_BUCKET,
  PUBLIC_IMAGE_BUCKET,
  detectMediaClass,
} from "../server/extraction";
import { processUploadJob, startUploadJob } from "../server/service";
import { makeWorld, tinyJpeg, tinyPdf, uploadAll, OWNER } from "./fakes";

describe("private staging and byte verification", () => {
  it("records observed size, sha256, and media class from actual bytes", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Verified Project" },
      files: [{ name: "photo.jpg", size: 999_999 }],
    });
    // Declared size (999999) differs from the actual stored bytes.
    uploadAll(world, started.uploads);
    await processUploadJob(world.deps, OWNER, started.jobId);

    const job = await world.data.getJob(started.jobId);
    const file = job!.files[0];
    expect(file.stagingBucket).toBe(PRIVATE_SOURCE_BUCKET);
    expect(file.observedSize).toBeGreaterThan(0);
    expect(file.observedSize).not.toBe(999_999);
    expect(file.declaredMismatch).toBe(true);
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file.mediaClass).toBe("image");
  });

  it("only selected media reach a public bucket; raw files stay private", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Selective Project" },
      files: [{ name: "photo.jpg" }, { name: "secret-legal.pdf" }, { name: "notes.txt" }],
    });
    uploadAll(world, started.uploads, { "secret-legal.pdf": tinyPdf() });
    await processUploadJob(world.deps, OWNER, started.jobId);

    // The photo is published; the legal PDF and notes stay private.
    const publicKeys = world.storage.publicKeys(PUBLIC_IMAGE_BUCKET);
    expect(publicKeys.length).toBe(1);
    expect(world.storage.publicKeys("project-documents")).toHaveLength(0);
    // The private staging objects for all three files remain.
    expect(world.storage.publicKeys(PRIVATE_SOURCE_BUCKET).length).toBeGreaterThanOrEqual(3);
  });

  it("rejects a forged media declaration (extension says image, bytes do not)", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Forged Project" },
      files: [{ name: "malware.jpg" }],
    });
    // A file named .jpg whose bytes are not an image.
    uploadAll(world, started.uploads, { "malware.jpg": Buffer.from("MZ this is not an image") });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published"); // never blocks
    expect(result.warnings.some((w) => w.code === "media_class_mismatch")).toBe(true);
    // Nothing forged reached the public bucket.
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(0);
    expect(world.executor.store.media).toHaveLength(0);
  });

  it("retains an oversized price-list PDF privately and still publishes", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Big Pdf Project" },
      files: [{ name: "Price List.pdf" }],
    });
    // Oversized (> parse cap) so it is never pulled into memory.
    const big = Buffer.concat([tinyPdf(), Buffer.alloc(MAX_PARSE_BYTES + 1024, 0x20)]);
    uploadAll(world, started.uploads, { "Price List.pdf": big });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published");
    expect(result.warnings.some((w) => w.code === "file_too_large_to_parse")).toBe(true);
    expect(world.executor.store.units).toHaveLength(0);
  });

  it("skips a byte-identical duplicate media file", async () => {
    const world = makeWorld();
    const identical = tinyJpeg();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Dup Project" },
      files: [{ name: "a.jpg" }, { name: "b.jpg" }],
    });
    uploadAll(world, started.uploads, { "a.jpg": identical, "b.jpg": identical });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.warnings.some((w) => w.code === "duplicate_media_ignored")).toBe(true);
    expect(world.executor.store.media).toHaveLength(1);
  });

  it("a finalization failure leaves NO public object (cleanup)", async () => {
    const world = makeWorld();
    world.data.failAfterIngest = true;
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Exposed None" },
      files: [{ name: "hero.jpg" }],
    });
    uploadAll(world, started.uploads);
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("failed");
    // The media was copied during gather, then cleaned up on failure.
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(0);
    expect(world.executor.publicProjects()).toHaveLength(0);
  });

  it("detects media class from magic bytes", () => {
    expect(detectMediaClass(tinyJpeg())).toBe("image");
    expect(detectMediaClass(tinyPdf())).toBe("pdf");
    expect(detectMediaClass(Buffer.from('{"a":1}'))).toBe("json");
    expect(detectMediaClass(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe("zip");
    expect(detectMediaClass(Buffer.from("random text"))).toBe("other");
  });
});
