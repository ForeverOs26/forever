import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { PRIVATE_SOURCE_BUCKET, PUBLIC_IMAGE_BUCKET } from "../server/extraction";
import {
  createPublicDerivative,
  MAX_MEDIA_SANITIZE_BYTES,
  verifyPublicDerivative,
} from "../server/media-truth";
import { processUploadJob, startUploadJob } from "../server/service";
import { makeWorld, tinyFtyp, uploadAll, OWNER } from "./fakes";
import {
  FIXTURE_PRIVATE_MARKERS,
  JFIF_THUMBNAIL_SECRET,
  syntheticJpeg,
  syntheticJpegWithJfifThumbnail,
  syntheticPng,
  syntheticWebp,
} from "./media-truth-fixtures";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function derive(bytes: Buffer, observedContentType: string) {
  return createPublicDerivative({
    bytes,
    originalSha256: digest(bytes),
    originalSize: bytes.length,
    observedContentType,
  });
}

function expectPrivateMarkersAbsent(bytes: Buffer) {
  const text = bytes.toString("latin1");
  for (const marker of FIXTURE_PRIVATE_MARKERS) expect.soft(text).not.toContain(marker);
  expect.soft(text).not.toContain("2026:01:02 03:04:05");
}

describe("FOREVER-MEDIA-TRUTH-001 byte sanitizers", () => {
  it("sanitizes JPEG EXIF/GPS/XMP/IPTC/comments and preserves orientation/dimensions", () => {
    const original = syntheticJpeg(true, 6);
    const untouched = Buffer.from(original);
    const result = derive(original, "image/jpeg");

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(original.equals(untouched)).toBe(true);
    expect(result.record.original.sha256).toBe(digest(original));
    expect(result.record.derivative!.sha256).toBe(digest(result.bytes));
    expect(result.record.derivative!.sha256).not.toBe(result.record.original.sha256);
    expect(result.record.claims).toMatchObject({
      capture_time: "2026:01:02 03:04:05",
      timezone: "+07:00",
      orientation: 6,
      dimensions: { width: 2, height: 3 },
      device_make: "FixtureCam Inc",
      device_model: "FixturePhone 9000",
      software: "FixtureEditor 1.0",
    });
    expect(result.record.claims.gps?.latitude).toBeCloseTo(12 + 34 / 60 + 56 / 3600);
    expect(result.record.claims.gps?.longitude).toBeCloseTo(98 + 45 / 60 + 54 / 3600);
    expect(result.record.claims.gps?.altitude).toBe(123);
    expect(result.record.sensitive_metadata_found).toBe(true);
    expectPrivateMarkersAbsent(result.bytes);
    expect(
      verifyPublicDerivative(result.bytes, "jpeg", {
        dimensions: { width: 2, height: 3 },
        orientation: 6,
      }),
    ).toEqual({ ok: true, forbidden: [] });
  });

  it("removes embedded JFIF thumbnails and verifies zero thumbnail dimensions", () => {
    const original = syntheticJpegWithJfifThumbnail(6);
    const originalHash = digest(original);
    expect(original.includes(JFIF_THUMBNAIL_SECRET)).toBe(true);

    const retainedThumbnailVerification = verifyPublicDerivative(original, "jpeg", {
      dimensions: { width: 2, height: 3 },
      orientation: 6,
    });
    expect(retainedThumbnailVerification.ok).toBe(false);
    expect(retainedThumbnailVerification.forbidden).toContain("jpeg_jfif_thumbnail");

    const result = derive(original, "image/jpeg");
    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.record.original).toEqual({ sha256: originalHash, size: original.length });
    expect(result.record.claims).toMatchObject({
      dimensions: { width: 2, height: 3 },
      orientation: 6,
    });
    expect(result.bytes.includes(JFIF_THUMBNAIL_SECRET)).toBe(false);
    const jfif = result.bytes.indexOf(Buffer.from("JFIF\0", "latin1"));
    expect(jfif).toBeGreaterThan(0);
    expect(result.bytes[jfif + 12]).toBe(0);
    expect(result.bytes[jfif + 13]).toBe(0);
    expect(
      verifyPublicDerivative(result.bytes, "jpeg", {
        dimensions: { width: 2, height: 3 },
        orientation: 6,
      }),
    ).toEqual({ ok: true, forbidden: [] });
  });

  it("fails closed on malformed JFIF thumbnail lengths", () => {
    const malformed = Buffer.from(syntheticJpegWithJfifThumbnail());
    const jfif = malformed.indexOf(Buffer.from("JFIF\0", "latin1"));
    malformed[jfif + 13] = 3;
    const result = derive(malformed, "image/jpeg");
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("malformed_media");
  });

  it("sanitizes PNG eXIf and text metadata without changing dimensions/orientation", () => {
    const original = syntheticPng(true, 8);
    const result = derive(original, "image/png");

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.record.claims.orientation).toBe(8);
    expect(result.record.claims.dimensions).toEqual({ width: 2, height: 3 });
    expect(result.record.claims.device_model).toBe("FixturePhone 9000");
    expect(result.record.derivative!.sha256).not.toBe(result.record.original.sha256);
    expectPrivateMarkersAbsent(result.bytes);
    expect(
      verifyPublicDerivative(result.bytes, "png", {
        dimensions: { width: 2, height: 3 },
        orientation: 8,
      }).ok,
    ).toBe(true);
  });

  it("sanitizes WebP EXIF/XMP, rewrites VP8X flags, and verifies the derivative", () => {
    const original = syntheticWebp(true, 3);
    const result = derive(original, "image/webp");

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.record.claims.orientation).toBe(3);
    expect(result.record.claims.dimensions).toEqual({ width: 2, height: 3 });
    expect(result.record.derivative!.sha256).not.toBe(result.record.original.sha256);
    expectPrivateMarkersAbsent(result.bytes);
    expect(
      verifyPublicDerivative(result.bytes, "webp", {
        dimensions: { width: 2, height: 3 },
        orientation: 3,
      }).ok,
    ).toBe(true);
  });

  it("accepts clean metadata-free images and records metadata_absent", () => {
    for (const [bytes, contentType] of [
      [syntheticJpeg(), "image/jpeg"],
      [syntheticPng(), "image/png"],
      [syntheticWebp(), "image/webp"],
    ] as const) {
      const result = derive(bytes, contentType);
      expect.soft(result.eligible).toBe(true);
      if (result.eligible) {
        expect.soft(result.record.parser.result).toBe("metadata_absent");
        expect.soft(result.record.sensitive_metadata_found).toBe(false);
        expect.soft(result.record.verification.result).toBe("verified");
      }
    }
  });

  it("rejects malformed JPEG, PNG, and WebP metadata/container blocks", () => {
    const jpeg = Buffer.from(syntheticJpeg(true, 6));
    const jpegExif = jpeg.indexOf(Buffer.from("Exif\0\0", "latin1"));
    jpeg.fill(0xff, jpegExif + 6, jpegExif + 14);

    const png = Buffer.from(syntheticPng(true, 6));
    const pngExif = png.indexOf(Buffer.from("II", "ascii"));
    png.fill(0xff, pngExif, pngExif + 8); // deliberately invalidates eXIf CRC too

    const webp = Buffer.from(syntheticWebp(true, 6));
    const webpExif = webp.indexOf(Buffer.from("Exif\0\0", "latin1"));
    webp.fill(0xff, webpExif + 6, webpExif + 14);

    for (const [bytes, contentType] of [
      [jpeg, "image/jpeg"],
      [png, "image/png"],
      [webp, "image/webp"],
    ] as const) {
      const result = derive(bytes, contentType);
      expect.soft(result.eligible).toBe(false);
      if (!result.eligible) {
        expect.soft(result.reason).toBe("malformed_media");
        expect.soft(result.record.derivative).toBeNull();
        expect.soft(result.record.verification.result).toBe("failed");
      }
    }
  });

  it("fails closed for HEIC/HEIF, AVIF, MP4/MOV, and a bounded-size overflow", () => {
    const cases = [
      [tinyFtyp("heic"), "image/heic"],
      [tinyFtyp("mif1"), "image/heif"],
      [tinyFtyp("avif"), "image/avif"],
      [tinyFtyp("mp42"), "video/mp4"],
      [tinyFtyp("qt  "), "video/quicktime"],
    ] as const;
    for (const [bytes, contentType] of cases) {
      const result = derive(bytes, contentType);
      expect.soft(result.eligible).toBe(false);
      if (!result.eligible) expect.soft(result.reason).toBe("unsupported_format");
    }
    const boundary = createPublicDerivative({
      bytes: Buffer.from([0xff, 0xd8, 0xff]),
      originalSha256: "0".repeat(64),
      originalSize: MAX_MEDIA_SANITIZE_BYTES + 1,
      observedContentType: "image/jpeg",
    });
    expect(boundary.eligible).toBe(false);
    if (!boundary.eligible) expect(boundary.reason).toBe("over_limit");
  });
});

describe("FOREVER-MEDIA-TRUTH-001 Studio integration", () => {
  it("publishes only the sanitized image, records both hashes privately, and keeps video private", async () => {
    const world = makeWorld();
    const privateJpeg = syntheticJpeg(true, 6);
    const originalHash = digest(privateJpeg);
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Synthetic Media Truth Project" },
      files: [{ name: "phone.jpg" }, { name: "phone.mov" }, { name: "phone.heic" }],
    });
    uploadAll(world, started.uploads, {
      "phone.jpg": privateJpeg,
      "phone.mov": tinyFtyp("qt  "),
      "phone.heic": tinyFtyp("heic"),
    });

    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published");
    expect(
      result.warnings.filter((warning) => warning.code === "media_sanitization_unsupported"),
    ).toHaveLength(2);
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(1);
    const publicPath = world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)[0];
    const derivative = world.storage.objects.get(`${PUBLIC_IMAGE_BUCKET}/${publicPath}`)!;
    expect(digest(derivative)).not.toBe(originalHash);
    expectPrivateMarkersAbsent(derivative);
    expect(
      world.storage.objects.get(`${PRIVATE_SOURCE_BUCKET}/${started.uploads[0].path}`),
    ).toEqual(privateJpeg);

    const job = await world.data.getJob(started.jobId);
    const jpegRecord = job!.files.find((file) => file.name === "phone.jpg")!;
    expect(jpegRecord.status).toBe("published_public");
    expect(jpegRecord.sha256).toBe(originalHash);
    expect(jpegRecord.mediaTruth).toMatchObject({
      sanitization_succeeded: true,
      original: { sha256: originalHash, size: privateJpeg.length },
      derivative: { sha256: digest(derivative), size: derivative.length, media_class: "image" },
      claims: { orientation: 6, device_model: "FixturePhone 9000" },
    });
    expect(world.executor.store.media[0].metadata).toMatchObject({
      studio: {
        job_id: started.jobId,
        media_truth: {
          original: { sha256: originalHash },
          derivative: { sha256: digest(derivative) },
          sanitization_succeeded: true,
        },
      },
    });
    expect(job!.files.find((file) => file.name === "phone.mov")!.publicPath).toBeUndefined();
    expect(job!.files.find((file) => file.name === "phone.heic")!.publicPath).toBeUndefined();
    for (const marker of FIXTURE_PRIVATE_MARKERS) {
      expect.soft(JSON.stringify(result.warnings)).not.toContain(marker);
    }
  });

  it("keeps hostile original filenames private across every public projection", async () => {
    const world = makeWorld();
    const names = [
      "Avery-Privacy-Person.jpg",
      "88-Fake-Privacy-Road-Unit-42.jpg",
      "private.person@example.invalid-+1-202-555-0199.jpg",
      "C:\\Users\\AveryPrivate\\Documents\\family-photo.jpg",
      "/Users/avery.private/Library/家庭照片.jpg",
      "../../../../秘密/ traversal-private.jpg",
    ];
    const warningName =
      "C:\\Users\\AveryPrivate\\88-Fake-Privacy-Road\\private.person@example.invalid.heic";
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Opaque Public Media" },
      files: [...names, warningName].map((name) => ({ name })),
    });
    const contents = Object.fromEntries(
      names.map((name, index) => [name, syntheticJpeg(true, 6, index + 1)]),
    );
    contents[warningName] = tinyFtyp("heic");
    uploadAll(world, started.uploads, contents);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    const serverLogs = errorSpy.mock.calls.flat().map(String).join("\n");
    errorSpy.mockRestore();

    expect(result.status).toBe("published");
    const keys = world.storage.publicKeys(PUBLIC_IMAGE_BUCKET);
    expect(keys).toHaveLength(names.length - 1);
    for (const [index, key] of keys.entries()) {
      expect(key).toMatch(
        new RegExp(
          `^studio/${started.jobId}/[a-zA-Z0-9]+/${String(index).padStart(2, "0")}-[a-f0-9]{16}\\.jpg$`,
        ),
      );
    }
    expect(world.executor.store.media.map((item) => item.title)).toEqual(
      names.slice(0, -1).map((_, index) => `Project photo ${index + 1}`),
    );

    const publicRecords = world.executor.store.media.map((item) => ({
      media_type: item.media_type,
      title: item.title,
      url: item.url,
      sort_order: item.sort_order,
    }));
    const publicBoundary = JSON.stringify({
      urls: keys,
      records: publicRecords,
      warnings: result.warnings,
      projectDetail: publicRecords,
      catalogue: publicRecords,
    });
    for (const privateValue of [
      "Avery-Privacy-Person",
      "88-Fake-Privacy-Road-Unit-42",
      "private.person@example.invalid",
      "+1-202-555-0199",
      "C:\\Users\\AveryPrivate",
      "/Users/avery.private",
      "家庭照片",
      "秘密",
      "traversal-private",
      "..",
    ]) {
      expect.soft(publicBoundary).not.toContain(privateValue);
      expect.soft(serverLogs).not.toContain(privateValue);
    }

    const privateJob = await world.data.getJob(started.jobId);
    expect(privateJob!.files.map((file) => file.name)).toEqual([...names, warningName]);
    expect(JSON.stringify(world.executor.store.media[0].metadata)).toContain(names[0]);
  });

  it("rejects a source changed between streamed hashing and bounded transformation", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Source Race" },
      files: [{ name: "phone.jpg" }],
    });
    uploadAll(world, started.uploads, { "phone.jpg": syntheticJpeg(true, 6) });
    const originalDownload = world.storage.downloadWithin.bind(world.storage);
    world.storage.downloadWithin = async (bucket, path, maxBytes) => {
      if (path === started.uploads[0].path) return syntheticJpeg(false, 1, 99);
      return originalDownload(bucket, path, maxBytes);
    };

    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published");
    expect(result.warnings.some((warning) => warning.code === "media_sanitization_failed")).toBe(
      true,
    );
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(0);
    expect((await world.data.getJob(started.jobId))!.files[0].mediaTruth).toMatchObject({
      sanitization_succeeded: false,
      derivative: null,
      verification: {
        result: "failed",
        forbidden_metadata: ["source_changed_after_hash"],
      },
    });
  });

  it("never returns a client-supplied private path in a media warning", async () => {
    const world = makeWorld();
    const privateName = "C:\\FixtureOwner\\private\\phone.heic";
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Warning Redaction" },
      files: [{ name: privateName }],
    });
    uploadAll(world, started.uploads, { [privateName]: tinyFtyp("heic") });

    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published");
    expect(
      result.warnings.some((warning) => warning.code === "media_sanitization_unsupported"),
    ).toBe(true);
    expect(JSON.stringify(result.warnings)).not.toContain("FixtureOwner");
    expect(JSON.stringify(result.warnings)).not.toContain("C:\\");
    expect((await world.data.getJob(started.jobId))!.files[0].name).toBe(privateName);
  });

  it("applies the same sanitizer to ZIP entries and stores entry evidence on the private container", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Archive Media Truth" },
      files: [{ name: "materials.zip" }],
    });
    world.archives.set("materials.zip", [
      { name: "C:/FixtureOwner/private/phone.jpg", data: syntheticJpeg(true, 6) },
    ]);
    uploadAll(world, started.uploads, {
      "materials.zip": Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
    });

    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published");
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(1);
    const archive = (await world.data.getJob(started.jobId))!.files[0];
    expect(archive.status).toBe("uploaded");
    expect(archive.publicPath).toBeUndefined();
    expect(archive.mediaTruthEntries).toHaveLength(1);
    expect(archive.mediaTruthEntries![0]).toMatchObject({
      name: "C:/FixtureOwner/private/phone.jpg",
      mediaTruth: { sanitization_succeeded: true, claims: { orientation: 6 } },
    });
  });

  it("is deterministic on replay and creates no duplicate media record", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Media Truth Replay" },
      files: [{ name: "phone.jpg" }],
    });
    uploadAll(world, started.uploads, { "phone.jpg": syntheticJpeg(true, 6) });
    const first = await processUploadJob(world.deps, OWNER, started.jobId);
    const firstKeys = world.storage.publicKeys(PUBLIC_IMAGE_BUCKET);
    const second = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(second).toEqual(first);
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toEqual(firstKeys);
    expect(world.executor.store.media).toHaveLength(1);
  });
});
