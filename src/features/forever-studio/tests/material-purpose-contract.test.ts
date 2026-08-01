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
  archiveEntryRouting,
  categoryForPurpose,
  classifyFileName,
  declareNewDirectJobFiles,
  purposeSourceForStoredFile,
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

/**
 * Rewrite a job's STORED manifest into the shape a row written before this
 * contract reads back with: no `materialPurpose`, no `purposeSource`, just the
 * category the classifier gave it at declaration time.
 *
 * It reaches into the stored row deliberately. `getJob` hands back a
 * structuredClone, so stripping the fields from its RESULT would leave the real
 * manifest fully purposed and the legacy path would never be exercised.
 */
function stripStoredPurposes(world: ReturnType<typeof makeWorld>, jobId: string): void {
  const stored = world.data.jobs.get(jobId);
  if (!stored) throw new Error("job missing");
  stored.files = stored.files.map((file) => {
    const legacy = { ...file };
    delete (legacy as Partial<StudioJobFile>).materialPurpose;
    delete (legacy as Partial<StudioJobFile>).purposeSource;
    return legacy;
  });
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
    const declared = declareNewDirectJobFiles("job-1", [
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
    const declared = declareNewDirectJobFiles("job-2", [
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

  it("NEVER falls back to the filename classifier when creating a new direct file", () => {
    // The creation path has no fail-open: an omitted purpose is refused, not
    // guessed. `price-list.pdf` would classify perfectly well — that is exactly
    // why accepting it would be the defect (review finding F2).
    for (const absent of [undefined, null, "", "   "]) {
      expect(() =>
        declareNewDirectJobFiles("job-3", [
          { name: "price-list.pdf", materialPurpose: absent as never },
        ]),
      ).toThrow(expect.objectContaining({ code: "material_purpose_required" }));
    }
  });

  it("never lets an unrecognized purpose string invent a category", () => {
    // Defence in depth: a bogus value reaching this layer is REFUSED, never
    // treated as absent and never trusted as routing.
    expect(() =>
      declareNewDirectJobFiles("job-4", [
        { name: "price-list.pdf", materialPurpose: "totally_made_up" as StudioMaterialPurpose },
      ]),
    ).toThrow(expect.objectContaining({ code: "material_purpose_invalid" }));
    for (const hostile of ["__proto__", "PRICE_LIST", "price-list", 42, {}, []]) {
      expect(() =>
        declareNewDirectJobFiles("job-4", [{ name: "a.pdf", materialPurpose: hostile as never }]),
      ).toThrow(expect.objectContaining({ code: "material_purpose_invalid" }));
    }
  });

  it("refuses the WHOLE declaration when only one file's purpose is bad", () => {
    expect(() =>
      declareNewDirectJobFiles("job-5", [
        { name: "good.jpg", materialPurpose: "project_photo" },
        { name: "bad.pdf", materialPurpose: undefined as never },
        { name: "also-good.pdf", materialPurpose: "brochure" },
      ]),
    ).toThrow(expect.objectContaining({ code: "material_purpose_required" }));
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
    expect(purposeSourceForStoredFile(explicit)).toBe("owner_selected");

    // A STORED manifest written before this contract keeps the category the
    // classifier gave it then — the read path, and only the read path, still
    // tolerates a purposeless entry.
    const legacy: StudioJobFile = { ...explicit, materialPurpose: null, category: "price-list" };
    expect(routingCategoryForFile(legacy)).toBe("price-list");
    expect(purposeSourceForStoredFile(legacy)).toBe("filename_fallback");
  });
});

describe("explicit material purpose — archive entry routing (the two permitted cases)", () => {
  it("classifies entries ONLY inside a Full Project Archive", () => {
    const routed = archiveEntryRouting("project_archive", "floor-plans/level-2.pdf");
    expect(routed.category).toBe("floor-plan");
    // Truthful provenance: the classifier routed it, the Owner did not.
    expect(routed.purposeSource).toBe("archive_entry_classifier");
  });

  it("inherits the outer window for every other window, whatever the entry is called", () => {
    // Each of these entry names classifies as something ELSE on its own, so an
    // inherited result cannot be a coincidence.
    const cases: Array<[StudioMaterialPurpose, string, string]> = [
      ["project_photo", "floor-plans/level-2.jpg", "photo"],
      ["price_list", "brochure-final.pdf", "price-list"],
      ["document_legal", "price-list.pdf", "legal-document"],
      ["construction_photo", "master-plan.jpg", "photo"],
      ["unit_plan", "IMG_20260731_120000.jpg", "unit-plan"],
    ];
    for (const [outer, entryName, expected] of cases) {
      const routed = archiveEntryRouting(outer, entryName);
      expect(routed.category, `${outer} :: ${entryName}`).toBe(expected);
      expect(routed.purposeSource, `${outer} :: ${entryName}`).toBe("inherited_explicit_window");
      // ...and the classifier really would have said something different.
      expect(classifyFileName(entryName), entryName).not.toBe(expected);
    }
  });

  it("treats a pre-contract archive with no recorded window as the legacy fallback", () => {
    const routed = archiveEntryRouting(null, "photos/site.jpg");
    expect(routed.category).toBe("photo");
    expect(routed.purposeSource).toBe("filename_fallback");
  });

  it("never reports an inherited or classified entry as individually owner-selected", () => {
    for (const outer of STUDIO_MATERIAL_PURPOSES) {
      expect(archiveEntryRouting(outer, "anything.jpg").purposeSource).not.toBe("owner_selected");
    }
    expect(archiveEntryRouting(null, "anything.jpg").purposeSource).not.toBe("owner_selected");
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
    // rather than restating a list that could drift, must use z.enum so an
    // unknown value FAILS validation instead of being silently stripped, and
    // must NOT mark the field optional — an omitted purpose is a refusal.
    const flat = source.replace(/\s+/g, " ");
    expect(flat).toMatch(/materialPurpose: z\s?\.enum\( ?STUDIO_MATERIAL_PURPOSES/);
    expect(flat).not.toMatch(/materialPurpose: z ?\.string\(\)/);
    expect(flat).not.toMatch(/materialPurpose: z\s?\.enum\([^)]*\)[^,]*\.optional\(\)/);
  });

  it("REFUSES a caller that sends no purpose at all, on a brand-new job", async () => {
    // The creation-time fallback is closed (review finding F2). A caller that
    // omits the field — a stale cached bundle, a future programmatic caller —
    // is refused rather than silently obtaining filename routing.
    for (const absent of [undefined, null, "", "   "]) {
      const world = makeWorld();
      await expect(
        startUploadJob(world.deps, OWNER, {
          workflow: "new_development",
          projectFacts: { name: "No Purpose" },
          files: [{ name: "brochure.pdf", materialPurpose: absent as never }],
        }),
        String(absent),
      ).rejects.toMatchObject({ code: "material_purpose_required" });
      // Nothing was allocated: no job row, no signed upload target.
      expect(world.data.jobs.size, String(absent)).toBe(0);
      expect(world.storage.signedUploads, String(absent)).toHaveLength(0);
    }
  });

  it("refuses a MIXED job atomically — one bad file, nothing written", async () => {
    const world = makeWorld();
    await expect(
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: "Mixed Validity" },
        files: [
          { name: "good.jpg", materialPurpose: "project_photo" },
          { name: "missing.pdf", materialPurpose: undefined as never },
          { name: "also-good.pdf", materialPurpose: "brochure" },
        ],
      }),
    ).rejects.toMatchObject({ code: "material_purpose_required" });
    expect(world.data.jobs.size).toBe(0);
    expect(world.storage.signedUploads).toHaveLength(0);
    expect(world.data.audits).toHaveLength(0);
  });

  it("re-checks the purpose in the SERVICE, before it even looks the project up", async () => {
    // The endpoint schema is not the only gate: the service layer refuses
    // independently, so an internal caller that never passes through the
    // endpoint cannot bypass it. Proven by WHERE the refusal happens — a bad
    // request must not reach the known-project-target lookup at all, which is
    // the first thing that would otherwise touch another publisher's project.
    const world = makeWorld();
    const looked: string[] = [];
    const realFind = world.data.findProjectBySlug.bind(world.data);
    world.data.findProjectBySlug = async (slug: string) => {
      looked.push(slug);
      return realFind(slug);
    };

    await expect(
      startUploadJob(world.deps, OWNER, {
        workflow: "project_update",
        projectSlug: "someone-elses-project",
        files: [{ name: "a.pdf", materialPurpose: undefined as never }],
      }),
    ).rejects.toMatchObject({ code: "material_purpose_required" });
    expect(looked).toEqual([]);

    // The same request WITH a purpose does reach the lookup, so the assertion
    // above is about the purpose gate and not about an unrelated early return.
    await startUploadJob(world.deps, OWNER, {
      workflow: "project_update",
      projectSlug: "someone-elses-project",
      files: [{ name: "a.pdf", materialPurpose: "document_legal" }],
    });
    expect(looked).toEqual(["someone-elses-project"]);
  });

  it("refuses an unknown purpose inside an otherwise valid job, atomically", async () => {
    const world = makeWorld();
    await expect(
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: "Mixed Unknown" },
        files: [
          { name: "good.jpg", materialPurpose: "project_photo" },
          { name: "bad.pdf", materialPurpose: "invented_window" as StudioMaterialPurpose },
        ],
      }),
    ).rejects.toMatchObject({ code: "material_purpose_invalid" });
    expect(world.data.jobs.size).toBe(0);
    expect(world.storage.signedUploads).toHaveLength(0);
  });

  it("still processes a STORED pre-contract manifest through the legacy fallback", async () => {
    // The legacy allowance lives in the read path, so a manifest written before
    // this contract still resumes — this is the boundary the creation-time
    // refusal above must not have broken.
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Stored Legacy" },
      files: [{ name: "brochure.pdf", materialPurpose: "document_legal" }],
    });
    stripStoredPurposes(world, started.jobId);
    const stored = (await world.data.getJob(started.jobId))!.files[0];
    expect(stored.materialPurpose).toBeUndefined();
    // The stored category survives; the filename (which says "brochure") does
    // NOT get to re-decide, so the fallback is the documented one and not a
    // fresh guess.
    expect(routingCategoryForFile(stored)).toBe("legal-document");
    expect(classifyFileName(stored.name)).toBe("brochure");
    expect(purposeSourceForStoredFile(stored)).toBe("filename_fallback");
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
      // Filed under windows that DISAGREE with what each filename says, so a
      // fallback that failed to engage would publish visibly different types.
      files: [
        { name: "master-plan.jpg", materialPurpose: "project_photo" },
        { name: "gallery-shot.jpg", materialPurpose: "master_plan" },
      ],
    });
    // Simulate a row written before this contract existed: strip the new fields
    // from the STORED row (getJob returns a clone, so mutating its result would
    // change nothing and the test would prove nothing).
    stripStoredPurposes(world, started.jobId);
    const reread = (await world.data.getJob(started.jobId))!;
    expect(reread.files.every((file) => file.materialPurpose === undefined)).toBe(true);
    uploadAll(world, started.uploads);

    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");
    // The legacy row keeps the category it was DECLARED with. Asserted per
    // file, not as a sorted set: re-classifying the filenames instead would
    // produce the same two media types swapped between the two files, and a
    // sorted comparison could not tell the two behaviours apart.
    const byName = Object.fromEntries(
      world.executor.store.media.map((item) => [
        (item.metadata as { studio?: { original_name?: string } }).studio?.original_name,
        item.media_type,
      ]),
    );
    expect(byName).toEqual({ "master-plan.jpg": "gallery", "gallery-shot.jpg": "master_plan" });
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
