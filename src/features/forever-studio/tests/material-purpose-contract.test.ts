/**
 * FOREVER-STUDIO-EXPLICIT-MATERIAL-SLOTS-001 — the Owner's chosen upload
 * window is the routing instruction.
 *
 * The Owner says what a file IS by choosing where to upload it. These tests
 * pin that the selection survives the whole path — request → validation →
 * private job manifest → extraction → publication — and that nothing
 * downstream is allowed to second-guess it from the filename.
 *
 * They also pin the two places filename classification is still permitted
 * (a manifest written before this contract existed, and entries discovered
 * inside an archive), and that byte-safety refusals retain the original
 * privately instead of quietly re-filing it under another purpose.
 */

import { describe, expect, it } from "vitest";

import {
  categoryForPurpose,
  classifyFileName,
  declareJobFiles,
  routingCategoryForFile,
} from "../server/extraction";
import { processUploadJob, startUploadJob } from "../server/service";
import {
  isStudioMaterialPurpose,
  STUDIO_MATERIAL_PURPOSES,
  STUDIO_MATERIAL_WINDOWS,
  type StudioJobFile,
  type StudioMaterialPurpose,
} from "../studio-types";
import { magicBytesFor, makeWorld, OWNER, tinyPdf, uploadAll } from "./fakes";

function fileNamed(files: StudioJobFile[], name: string): StudioJobFile {
  const found = files.find((file) => file.name === name);
  if (!found) throw new Error(`no manifest entry for ${name}`);
  return found;
}

async function jobFiles(world: ReturnType<typeof makeWorld>, jobId: string) {
  const job = await world.data.getJob(jobId);
  if (!job) throw new Error("job missing");
  return job.files;
}

describe("explicit material purpose — vocabulary", () => {
  it("exposes one window per purpose, with no purpose left unlabelled", () => {
    expect(STUDIO_MATERIAL_WINDOWS).toHaveLength(STUDIO_MATERIAL_PURPOSES.length);
    for (const purpose of STUDIO_MATERIAL_PURPOSES) {
      const window = STUDIO_MATERIAL_WINDOWS.find((entry) => entry.purpose === purpose);
      expect(window, purpose).toBeDefined();
      expect(window!.label.length).toBeGreaterThan(0);
      // One short sentence explaining what belongs here.
      expect(window!.hint.length).toBeGreaterThan(0);
    }
  });

  it("maps every purpose deterministically into the ingestion vocabulary", () => {
    for (const purpose of STUDIO_MATERIAL_PURPOSES) {
      const first = categoryForPurpose(purpose);
      expect(first, purpose).toBeTruthy();
      // Deterministic: nothing but the purpose participates.
      expect(categoryForPurpose(purpose)).toBe(first);
    }
    expect(categoryForPurpose("price_list")).toBe("price-list");
    expect(categoryForPurpose("project_photo")).toBe("photo");
    expect(categoryForPurpose("project_archive")).toBe("archive");
  });

  it("treats the purpose list as a CLOSED allowlist", () => {
    expect(isStudioMaterialPurpose("price_list")).toBe(true);
    for (const value of [
      "not_a_purpose",
      "PRICE_LIST",
      "price-list",
      "__proto__",
      "",
      null,
      undefined,
      42,
      { purpose: "price_list" },
    ]) {
      expect(isStudioMaterialPurpose(value), String(value)).toBe(false);
    }
  });
});

describe("explicit material purpose — declaration routing", () => {
  it("routes a directly uploaded file from its window, never its filename", () => {
    const declared = declareJobFiles("job-1", [
      // Every one of these filenames would classify DIFFERENTLY on its own.
      { name: "document.pdf", materialPurpose: "price_list" },
      { name: "price-list.pdf", materialPurpose: "document_legal" },
      { name: "master-plan.jpg", materialPurpose: "project_photo" },
      { name: "brochure-final.pdf", materialPurpose: "payment_plan" },
      { name: "IMG_20260731_120000.jpg", materialPurpose: "construction_photo" },
    ]);

    expect(fileNamed(declared, "document.pdf").category).toBe("price-list");
    expect(fileNamed(declared, "price-list.pdf").category).toBe("legal-document");
    expect(fileNamed(declared, "master-plan.jpg").category).toBe("photo");
    expect(fileNamed(declared, "brochure-final.pdf").category).toBe("payment-plan");
    expect(fileNamed(declared, "IMG_20260731_120000.jpg").category).toBe("photo");

    // Each retains the ORIGINAL Owner selection, marked as owner-selected.
    for (const file of declared) {
      expect(file.purposeSource, file.name).toBe("owner_selected");
      expect(isStudioMaterialPurpose(file.materialPurpose), file.name).toBe(true);
    }
    expect(fileNamed(declared, "IMG_20260731_120000.jpg").materialPurpose).toBe(
      "construction_photo",
    );
  });

  it("proves the filename classifier would have disagreed on every one of those", () => {
    // Without this the routing test above could pass vacuously.
    expect(classifyFileName("price-list.pdf")).toBe("price-list");
    expect(classifyFileName("master-plan.jpg")).toBe("master-plan");
    expect(classifyFileName("brochure-final.pdf")).toBe("brochure");
    expect(classifyFileName("document.pdf")).toBe("legal-document");
    expect(classifyFileName("IMG_20260731_120000.jpg")).toBe("photo");
  });

  it("accepts arbitrary, meaningless and non-Latin filenames without special naming", () => {
    const declared = declareJobFiles("job-2", [
      { name: "aaa.pdf", materialPurpose: "price_list" },
      { name: "1.pdf", materialPurpose: "payment_plan" },
      { name: "สำเนา เอกสาร.pdf", materialPurpose: "document_legal" },
      { name: "スクリーンショット.png", materialPurpose: "unit_plan" },
      { name: "  spaced name (2).JPG", materialPurpose: "project_photo" },
    ]);
    expect(declared.map((file) => file.category)).toEqual([
      "price-list",
      "payment-plan",
      "legal-document",
      "unit-plan",
      "photo",
    ]);
    expect(declared.every((file) => file.purposeSource === "owner_selected")).toBe(true);
  });

  it("falls back to the filename classifier ONLY when no purpose was supplied", () => {
    const declared = declareJobFiles("job-3", [{ name: "price-list.pdf" }, { name: "photo.jpg" }]);
    expect(fileNamed(declared, "price-list.pdf").category).toBe("price-list");
    expect(fileNamed(declared, "photo.jpg").category).toBe("photo");
    for (const file of declared) {
      expect(file.purposeSource, file.name).toBe("filename_fallback");
      expect(file.materialPurpose, file.name).toBeNull();
    }
  });

  it("never lets an unrecognized purpose string invent a category", () => {
    const declared = declareJobFiles("job-4", [
      // Defence in depth: even if a bogus value reached this layer it is
      // treated as ABSENT (documented fallback), never trusted as routing.
      { name: "price-list.pdf", materialPurpose: "totally_made_up" as StudioMaterialPurpose },
    ]);
    expect(declared[0].materialPurpose).toBeNull();
    expect(declared[0].purposeSource).toBe("filename_fallback");
    expect(declared[0].category).toBe("price-list");
  });

  it("re-derives a stored explicit entry from its purpose, so a retry cannot drift", () => {
    const explicit: StudioJobFile = {
      name: "price-list.pdf",
      stagingBucket: "studio-uploads",
      stagingPath: "jobs/x/staging/00-price-list.pdf",
      declaredSize: null,
      declaredType: null,
      materialPurpose: "document_legal",
      purposeSource: "owner_selected",
      // Even a manifest whose stored category was tampered with re-derives
      // from the Owner's purpose.
      category: "price-list",
      status: "declared",
    };
    expect(routingCategoryForFile(explicit)).toBe("legal-document");

    const legacy: StudioJobFile = { ...explicit, materialPurpose: null, category: "price-list" };
    expect(routingCategoryForFile(legacy)).toBe("price-list");
  });
});

describe("explicit material purpose — server validation", () => {
  it("rejects an unknown purpose instead of guessing or silently dropping it", async () => {
    const world = makeWorld();
    await expect(
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: "Bad Purpose" },
        files: [{ name: "a.pdf", materialPurpose: "hacked_purpose" as StudioMaterialPurpose }],
      }),
    ).rejects.toMatchObject({ code: "material_purpose_invalid" });
    // Refused before any job or signed upload target was allocated.
    expect(world.data.jobs).toHaveLength(0);
  });

  it("preserves a known selected purpose all the way into the private manifest", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Preserved Purpose" },
      files: [
        { name: "document.pdf", materialPurpose: "price_list" },
        { name: "price-list.pdf", materialPurpose: "document_legal" },
      ],
    });
    const files = await jobFiles(world, started.jobId);
    expect(fileNamed(files, "document.pdf").materialPurpose).toBe("price_list");
    expect(fileNamed(files, "document.pdf").category).toBe("price-list");
    expect(fileNamed(files, "price-list.pdf").materialPurpose).toBe("document_legal");
    expect(fileNamed(files, "price-list.pdf").category).toBe("legal-document");
  });

  it("constrains the browser-facing validator to the SAME closed list", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(
      resolve(process.cwd(), "src/features/forever-studio/studio.functions.ts"),
      "utf8",
    );
    // The endpoint schema must derive its allowlist from the shared constant
    // rather than restating a list that could drift, and must use z.enum so an
    // unknown value FAILS validation instead of being silently stripped.
    const flat = source.replace(/\s+/g, " ");
    expect(flat).toContain("materialPurpose: z .enum(STUDIO_MATERIAL_PURPOSES");
    expect(flat).not.toMatch(/materialPurpose: z ?\.string\(\)/);
  });

  it("still accepts a legacy caller that sends no purpose at all", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Legacy Caller" },
      files: [{ name: "brochure.pdf" }],
    });
    const files = await jobFiles(world, started.jobId);
    expect(fileNamed(files, "brochure.pdf").purposeSource).toBe("filename_fallback");
    expect(fileNamed(files, "brochure.pdf").category).toBe("brochure");
  });
});

describe("explicit material purpose — end-to-end publication", () => {
  /**
   * The PDF price-list lane is the sharpest observable: it runs if and only if
   * the routing category is `price-list`. The test world's PDF extractor emits
   * `price_list_extraction_unavailable` whenever it is called, so that warning
   * is a direct witness of which lane a file took.
   */
  const PRICE_LANE = "price_list_extraction_unavailable";

  it("sends an arbitrarily named PDF down the Price List lane the Owner chose", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Arbitrary Name" },
      // Nothing in this filename says "price list".
      files: [{ name: "document.pdf", materialPurpose: "price_list" }],
    });
    uploadAll(world, started.uploads, { "document.pdf": tinyPdf() });

    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");
    // The price-list lane ran because the WINDOW said price list.
    expect(result.warnings.some((warning) => warning.code === PRICE_LANE)).toBe(true);
    const files = await jobFiles(world, started.jobId);
    expect(fileNamed(files, "document.pdf").materialPurpose).toBe("price_list");
    expect(fileNamed(files, "document.pdf").category).toBe("price-list");
  });

  it("keeps a price-list-named PDF uploaded under Documents out of the price lane", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Misleading Name" },
      files: [{ name: "price-list.pdf", materialPurpose: "document_legal" }],
    });
    uploadAll(world, started.uploads, { "price-list.pdf": tinyPdf() });

    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");
    // The filename would have routed it into price extraction; the window won.
    expect(result.warnings.some((warning) => warning.code === PRICE_LANE)).toBe(false);
    const files = await jobFiles(world, started.jobId);
    expect(fileNamed(files, "price-list.pdf").category).toBe("legal-document");
    expect(fileNamed(files, "price-list.pdf").materialPurpose).toBe("document_legal");
  });

  it("proves the same filename takes the OPPOSITE lane when its window changes", async () => {
    // The pair above, run as one controlled comparison: identical bytes,
    // identical filename, only the chosen window differs.
    const lanes: Array<{ purpose: StudioMaterialPurpose; ran: boolean }> = [
      { purpose: "price_list", ran: true },
      { purpose: "document_legal", ran: false },
    ];
    for (const lane of lanes) {
      const world = makeWorld();
      const started = await startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: `Lane ${lane.purpose}` },
        files: [{ name: "same-name.pdf", materialPurpose: lane.purpose }],
      });
      uploadAll(world, started.uploads, { "same-name.pdf": tinyPdf() });
      const result = await processUploadJob(world.deps, OWNER, started.jobId);
      expect(
        result.warnings.some((warning) => warning.code === PRICE_LANE),
        lane.purpose,
      ).toBe(lane.ran);
    }
  });

  it("publishes a plan-named image uploaded under Project Photos as a photo", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Plan Named Photo" },
      files: [{ name: "master-plan.jpg", materialPurpose: "project_photo" }],
    });
    uploadAll(world, started.uploads);

    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");
    const media = world.executor.store.media;
    expect(media).toHaveLength(1);
    // "gallery", not "master_plan": the window decided, not the filename.
    expect(media[0].media_type).toBe("gallery");
    expect(
      (media[0].metadata as { studio?: { material_purpose?: string } }).studio?.material_purpose,
    ).toBe("project_photo");
  });

  it("titles a camera-named photo uploaded under Construction as a construction update", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      // NOT the construction workflow: the WINDOW carries the meaning.
      workflow: "new_development",
      projectFacts: { name: "Construction Window" },
      files: [{ name: "IMG_4821.jpg", materialPurpose: "construction_photo" }],
    });
    uploadAll(world, started.uploads);

    expect((await processUploadJob(world.deps, OWNER, started.jobId)).status).toBe("published");
    const media = world.executor.store.media;
    expect(media).toHaveLength(1);
    expect(media[0].title).toMatch(/^Construction update /);
    expect(
      (media[0].metadata as { studio?: { material_purpose?: string } }).studio?.material_purpose,
    ).toBe("construction_photo");
  });

  it("carries several different windows through one job", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Many Windows" },
      files: [
        { name: "a.jpg", materialPurpose: "project_photo" },
        { name: "b.pdf", materialPurpose: "brochure" },
        { name: "c.pdf", materialPurpose: "payment_plan" },
        { name: "d.jpg", materialPurpose: "floor_plan" },
        { name: "e.jpg", materialPurpose: "construction_photo" },
      ],
    });
    uploadAll(world, started.uploads);

    expect((await processUploadJob(world.deps, OWNER, started.jobId)).status).toBe("published");
    const files = await jobFiles(world, started.jobId);
    // Five windows, five distinct purposes, all preserved on one job.
    expect(files.map((file) => file.materialPurpose)).toEqual([
      "project_photo",
      "brochure",
      "payment_plan",
      "floor_plan",
      "construction_photo",
    ]);
    expect(files.map((file) => file.category)).toEqual([
      "photo",
      "brochure",
      "payment-plan",
      "floor-plan",
      "photo",
    ]);
    // The images each publish under the media type their WINDOW implies.
    // (PDF originals stay private — unchanged behaviour, unrelated to purpose.)
    const types = world.executor.store.media.map((item) => item.media_type).sort();
    expect(types).toEqual(["floor_plan", "gallery", "gallery"]);
    const purposes = world.executor.store.media
      .map(
        (item) =>
          (item.metadata as { studio?: { material_purpose?: string } }).studio?.material_purpose,
      )
      .sort();
    expect(purposes).toEqual(["construction_photo", "floor_plan", "project_photo"]);
  });

  it("publishes with no materials at all — every window is optional", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Nothing Uploaded" },
      files: [],
    });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");
    expect(world.executor.store.projects).toHaveLength(1);
  });

  it("publishes when only ONE window was used and every other stayed empty", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "One Window Only" },
      files: [{ name: "only.jpg", materialPurpose: "project_photo" }],
    });
    uploadAll(world, started.uploads);
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    // Missing categories never block publication and never queue a review.
    expect(result.status).toBe("published");
    expect(result.pagePath).toBeTruthy();
  });
});

describe("explicit material purpose — byte safety is unchanged", () => {
  it("never silently re-files bytes that contradict the chosen window", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Wrong Bytes" },
      files: [
        // A PDF the Owner put in the PHOTO window.
        { name: "actually-a-pdf.jpg", materialPurpose: "project_photo" },
        { name: "good.jpg", materialPurpose: "project_photo" },
      ],
    });
    uploadAll(world, started.uploads, { "actually-a-pdf.jpg": tinyPdf() });

    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    // The job still publishes: one bad file never blocks the rest.
    expect(result.status).toBe("published");
    expect(result.warnings.some((warning) => warning.code === "media_class_mismatch")).toBe(true);

    const files = await jobFiles(world, started.jobId);
    const bad = fileNamed(files, "actually-a-pdf.jpg");
    // Purpose and category UNCHANGED — not quietly moved to a document window.
    expect(bad.materialPurpose).toBe("project_photo");
    expect(bad.category).toBe("photo");
    // Kept private: no public object was created for it.
    expect(bad.publicPath ?? null).toBeNull();
    expect(bad.status).not.toBe("published_public");
    // The observed byte class was still recorded truthfully.
    expect(bad.mediaClass).toBe("pdf");
    // The usable file published normally.
    expect(fileNamed(files, "good.jpg").status).toBe("published_public");
    expect(world.executor.store.media).toHaveLength(1);
  });

  it("keeps an executable renamed .pdf private without changing its purpose", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Renamed Executable" },
      files: [{ name: "brochure.pdf", materialPurpose: "brochure" }],
    });
    // MZ header: a Windows executable wearing a .pdf name.
    uploadAll(world, started.uploads, {
      "brochure.pdf": Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(64, 0x00)]),
    });

    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");
    const files = await jobFiles(world, started.jobId);
    const file = fileNamed(files, "brochure.pdf");
    expect(file.materialPurpose).toBe("brochure");
    expect(file.category).toBe("brochure");
    expect(file.publicBucket ?? null).toBeNull();
    expect(file.publicPath ?? null).toBeNull();
    expect(world.executor.store.media).toHaveLength(0);
  });

  it("still records observed bytes, hash and declared mismatch for explicit files", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Byte Truth" },
      files: [
        {
          name: "photo.jpg",
          size: 999_999,
          contentType: "image/jpeg",
          materialPurpose: "project_photo",
        },
      ],
    });
    uploadAll(world, started.uploads);

    expect((await processUploadJob(world.deps, OWNER, started.jobId)).status).toBe("published");
    const file = fileNamed(await jobFiles(world, started.jobId), "photo.jpg");
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(file.observedSize).toBe(magicBytesFor("photo.jpg").length);
    expect(file.mediaClass).toBe("image");
    // Declared 999_999 bytes, stored far fewer: recorded, stored bytes win.
    expect(file.declaredMismatch).toBe(true);
    // ...and the Owner's purpose survived the mismatch untouched.
    expect(file.materialPurpose).toBe("project_photo");
  });
});

describe("explicit material purpose — archives and legacy jobs", () => {
  it("routes archive entries by the bounded classifier, without touching direct files", async () => {
    const world = makeWorld();
    world.archives.set("package.zip", [
      { name: "photos/site.jpg", data: magicBytesFor("site.jpg") },
      { name: "floor-plans/level-1.png", data: magicBytesFor("level-1.png") },
    ]);
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Archive Fallback" },
      files: [
        { name: "package.zip", materialPurpose: "project_archive" },
        // A direct file whose name would classify as a floor plan.
        { name: "floor-plan.jpg", materialPurpose: "project_photo" },
      ],
    });
    uploadAll(world, started.uploads, {
      "package.zip": Buffer.from("PK fake-zip"),
    });

    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");

    const types = world.executor.store.media.map((item) => item.media_type).sort();
    // Archive entries used their in-archive paths (photo + floor plan), and the
    // DIRECT file still followed its window (gallery, not floor_plan).
    expect(types).toEqual(["floor_plan", "gallery", "gallery"]);

    const files = await jobFiles(world, started.jobId);
    expect(fileNamed(files, "package.zip").materialPurpose).toBe("project_archive");
    expect(fileNamed(files, "package.zip").category).toBe("archive");
    expect(fileNamed(files, "floor-plan.jpg").category).toBe("photo");
  });

  it("processes a legacy manifest with no purpose exactly as it did before", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Legacy Manifest" },
      files: [{ name: "master-plan.jpg" }, { name: "gallery-shot.jpg" }],
    });
    // Simulate a row written before this contract existed: strip the new
    // fields entirely, exactly as an old manifest would read back.
    const job = (await world.data.getJob(started.jobId))!;
    job.files = job.files.map((file) => {
      const legacy = { ...file };
      delete (legacy as Partial<StudioJobFile>).materialPurpose;
      delete (legacy as Partial<StudioJobFile>).purposeSource;
      return legacy;
    });
    uploadAll(world, started.uploads);

    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");
    const types = world.executor.store.media.map((item) => item.media_type).sort();
    // Classifier fallback still routes the legacy job: master plan + gallery.
    expect(types).toEqual(["gallery", "master_plan"]);
  });
});

describe("explicit material purpose — retry and idempotency", () => {
  it("keeps purposes stable across a retry and publishes exactly once", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Retry Stability" },
      files: [
        { name: "document.pdf", materialPurpose: "price_list" },
        { name: "shot.jpg", materialPurpose: "construction_photo" },
      ],
    });
    uploadAll(world, started.uploads, { "document.pdf": tinyPdf() });

    world.data.failAfterIngest = true;
    const failed = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(failed.status).toBe("failed");
    expect(failed.retryable).toBe(true);
    world.data.failAfterIngest = false;

    // Purposes are untouched by the failure.
    const afterFailure = await jobFiles(world, started.jobId);
    expect(fileNamed(afterFailure, "document.pdf").materialPurpose).toBe("price_list");
    expect(fileNamed(afterFailure, "shot.jpg").materialPurpose).toBe("construction_photo");

    const retried = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(retried.status).toBe("published");
    expect(world.executor.store.projects).toHaveLength(1);

    const afterRetry = await jobFiles(world, started.jobId);
    expect(fileNamed(afterRetry, "document.pdf").materialPurpose).toBe("price_list");
    expect(fileNamed(afterRetry, "document.pdf").category).toBe("price-list");
    expect(fileNamed(afterRetry, "shot.jpg").materialPurpose).toBe("construction_photo");

    // A duplicate request stays idempotent.
    expect((await processUploadJob(world.deps, OWNER, started.jobId)).status).toBe("published");
    expect(world.executor.store.projects).toHaveLength(1);
  });
});

describe("explicit material purpose — no review, readiness or approval gate", () => {
  it("produces owner_provided provenance and publishes straight away", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Direct Authorization" },
      files: [{ name: "a.jpg", materialPurpose: "project_photo" }],
    });
    uploadAll(world, started.uploads);

    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    // One call: upload IS the authorization. No intermediate approval status.
    expect(result.status).toBe("published");
    const project = world.executor.store.projects[0];
    const provenance = JSON.stringify(project?.field_provenance ?? {});
    expect(provenance).toContain("owner_provided");
    expect(provenance).not.toContain("owner_verified");
    expect(provenance).not.toContain("forever_verified");
  });

  it("introduces no readiness, completeness or approval vocabulary anywhere in the lane", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    const sources = [
      "src/features/forever-studio/components/StudioUploader.tsx",
      "src/features/forever-studio/studio-types.ts",
      "src/features/forever-studio/studio.functions.ts",
      "src/features/forever-studio/server/extraction.ts",
    ];
    // Words that would signal a second gate between upload and publication.
    const forbidden = [
      "readinessScore",
      "completenessScore",
      "approvalQueue",
      "verificationQueue",
      "awaiting_approval",
      "pending_review",
      "readyForPublication",
      "confirmSource",
      "Ready for publication",
      "Confirm source",
      "Verify developer material",
    ];
    for (const path of sources) {
      const source = read(path);
      for (const word of forbidden) {
        expect(source, `${path} :: ${word}`).not.toContain(word);
      }
    }
    // ...and the product promise is still stated to the Owner.
    expect(read("src/features/forever-studio/components/StudioUploader.tsx")).toContain(
      "Missing information never blocks publication.",
    );
  });
});
