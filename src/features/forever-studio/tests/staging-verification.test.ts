/**
 * FOREVER-STUDIO-001 — private staging + byte verification (items 4 & 5).
 *
 * Every file lands in private staging; the actual bytes are verified (size,
 * sha256, media class, declared-vs-observed); only selected, byte-matching
 * final media become verified derivatives in public buckets; a failed job exposes no public
 * object; oversized business files are retained, never blocking; and forged
 * media declarations are rejected.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_PARSE_BYTES,
  PRIVATE_SOURCE_BUCKET,
  PUBLIC_IMAGE_BUCKET,
  canonicalPublicContentType,
  detectMediaClass,
} from "../server/extraction";
import { processUploadJob, startUploadJob } from "../server/service";
import { makeWorld, tinyFtyp, tinyJpeg, tinyPdf, uploadAll, OWNER } from "./fakes";

/** A media file well past the former in-memory hashing threshold (25 MiB). */
function largeMedia(head: Buffer, totalBytes = 26 * 1024 * 1024): Buffer {
  return Buffer.concat([head, Buffer.alloc(totalBytes - head.length, 0x33)]);
}

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
    // The derivative was uploaded during gather, then cleaned up on failure.
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

  it("classifies ftyp containers by brand: HEIC/HEIF are images, not video", () => {
    expect(detectMediaClass(tinyFtyp("heic"))).toBe("image");
    expect(detectMediaClass(tinyFtyp("heix"))).toBe("image");
    expect(detectMediaClass(tinyFtyp("mif1"))).toBe("image"); // HEIF
    expect(detectMediaClass(tinyFtyp("avif"))).toBe("image");
    expect(detectMediaClass(tinyFtyp("mp42"))).toBe("video");
    expect(detectMediaClass(tinyFtyp("isom"))).toBe("video");
    expect(detectMediaClass(tinyFtyp("qt  "))).toBe("video"); // MOV
    // A generic/unknown ftyp container is NOT assumed to be video.
    expect(detectMediaClass(tinyFtyp("abcd"))).toBe("other");
  });

  it("derives canonical public MIME from verified bytes, never source metadata", () => {
    expect(canonicalPublicContentType("x.jpg", tinyJpeg(), "image")).toBe("image/jpeg");
    expect(canonicalPublicContentType("x.heic", tinyFtyp("heic"), "image")).toBe("image/heic");
    expect(canonicalPublicContentType("x.heif", tinyFtyp("mif1"), "image")).toBe("image/heif");
    expect(canonicalPublicContentType("x.mp4", tinyFtyp("mp42"), "video")).toBe("video/mp4");
    expect(canonicalPublicContentType("x.mov", tinyFtyp("qt  "), "video")).toBe("video/quicktime");
  });

  it("publishes only sanitizable phone media with canonical MIME and retains other formats", async () => {
    const world = makeWorld();
    const bytes: Record<string, Buffer> = {
      "photo.jpg": tinyJpeg(),
      "phone.heic": tinyFtyp("heic"),
      "phone.heif": tinyFtyp("mif1"),
      "clip.mp4": tinyFtyp("mp42"),
      "clip.mov": tinyFtyp("qt  "),
    };
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Canonical MIME Project" },
      files: Object.keys(bytes).map((name) => ({ name, contentType: "text/html" })),
    });
    for (const upload of started.uploads) {
      world.storage.put(upload.bucket, upload.path, bytes[upload.name], "text/html");
    }

    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");
    const publicPaths = world.storage.publicKeys(PUBLIC_IMAGE_BUCKET);
    expect(publicPaths).toHaveLength(1);
    expect(publicPaths[0]).toMatch(/\/00-[a-f0-9]{16}\.jpg$/);
    expect(publicPaths[0]).not.toContain("photo");
    expect(world.storage.publicContentType(PUBLIC_IMAGE_BUCKET, publicPaths[0])).toBe("image/jpeg");
    expect(
      result.warnings.filter((warning) => warning.code === "media_sanitization_unsupported"),
    ).toHaveLength(4);
  });

  it("streams a FULL SHA-256 for large media but retains it beyond the transform cap", async () => {
    const world = makeWorld();
    const big = largeMedia(tinyJpeg());
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Large Photo Project" },
      files: [{ name: "hero.jpg", size: big.length }],
    });
    uploadAll(world, started.uploads, { "hero.jpg": big });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published");
    const job = await world.data.getJob(started.jobId);
    const file = job!.files[0];
    // Full digest + exact size from the actual stored bytes, streamed.
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file.observedSize).toBe(big.length);
    expect(file.mediaClass).toBe("image");
    expect(world.storage.hashedPaths).toContain(`${file.stagingBucket}/${file.stagingPath}`);
    expect(result.warnings.some((warning) => warning.code === "media_sanitization_limit")).toBe(
      true,
    );
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(0);
  });

  it("refuses a LARGE disguised media file — bytes decide, not the extension", async () => {
    const world = makeWorld();
    // Named .jpg / .mp4 but the bytes are not that media type.
    const fakeJpg = largeMedia(Buffer.from("MZ not an image at all"));
    const fakeMp4 = largeMedia(Buffer.from("RIFFxxxxWAVE not video"));
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Disguise Project" },
      files: [{ name: "big-fake.jpg" }, { name: "big-fake.mp4" }],
    });
    uploadAll(world, started.uploads, { "big-fake.jpg": fakeJpg, "big-fake.mp4": fakeMp4 });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published"); // never blocks
    expect(
      result.warnings.filter((w) => w.code === "media_class_mismatch").length,
    ).toBeGreaterThanOrEqual(2);
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(0);
    expect(world.executor.store.media).toHaveLength(0);
  });

  it("records a forged declared size as a mismatch with a warning", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Forged Size Project" },
      files: [{ name: "photo.jpg", size: 123_456_789 }],
    });
    uploadAll(world, started.uploads); // actual bytes are tiny
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published");
    const file = (await world.data.getJob(started.jobId))!.files[0];
    expect(file.declaredMismatch).toBe(true);
    expect(file.observedSize).not.toBe(123_456_789);
    expect(result.warnings.some((w) => w.code === "file_declared_size_mismatch")).toBe(true);
  });

  it("detects phone HEIC/HEIF/MOV bytes but retains them until a safe sanitizer exists", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Phone Formats Project" },
      files: [{ name: "IMG_1.heic" }, { name: "IMG_2.heif" }, { name: "clip.mov" }],
    });
    uploadAll(world, started.uploads, {
      "IMG_1.heic": Buffer.concat([tinyFtyp("heic"), Buffer.from("::1")]),
      "IMG_2.heif": Buffer.concat([tinyFtyp("mif1"), Buffer.from("::2")]),
      "clip.mov": Buffer.concat([tinyFtyp("qt  "), Buffer.from("::3")]),
    });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published");
    expect(
      result.warnings.filter((warning) => warning.code === "media_sanitization_unsupported"),
    ).toHaveLength(3);
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(0);
    expect(world.executor.store.media).toHaveLength(0);
  });

  it("keeps an unrecognized LARGE ftyp container private without blocking", async () => {
    const world = makeWorld();
    const unknown = largeMedia(tinyFtyp("abcd"));
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Unknown Container Project" },
      files: [{ name: "mystery.mp4" }, { name: "real.jpg" }],
    });
    uploadAll(world, started.uploads, { "mystery.mp4": unknown });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published");
    expect(result.warnings.some((w) => w.code === "media_class_mismatch")).toBe(true);
    // Only the real photo was published; the unknown container stays private.
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(1);
    const job = await world.data.getJob(started.jobId);
    const mystery = job!.files.find((f) => f.name === "mystery.mp4");
    expect(mystery?.status).toBe("uploaded");
    expect(mystery?.publicPath ?? null).toBeNull();
    expect(mystery?.sha256).toMatch(/^[0-9a-f]{64}$/); // still fully verified
  });

  it("skips a byte-identical LARGE duplicate (hash covers every size)", async () => {
    const world = makeWorld();
    const big = largeMedia(tinyJpeg());
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Large Dup Project" },
      files: [{ name: "a.jpg" }, { name: "b.jpg" }],
    });
    uploadAll(world, started.uploads, { "a.jpg": big, "b.jpg": Buffer.from(big) });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.warnings.some((w) => w.code === "duplicate_media_ignored")).toBe(true);
    expect(result.warnings.some((w) => w.code === "media_sanitization_limit")).toBe(true);
    expect(world.executor.store.media).toHaveLength(0);
  });
});
