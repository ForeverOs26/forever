/**
 * FOREVER-PR130-MATERIAL-SLOTS-CORRECTION-001 — F1: the transport lane never
 * decides what the material IS.
 *
 * A ZIP above the inline cap travels the resumable chunked lane. That is a size
 * decision. Before this correction it was also, silently, a routing decision:
 * the archive left the job's file manifest, the plan contract carried no
 * purpose, and every entry inside was classified by its filename — so material
 * the Owner filed under Documents / Legal could publish into the public gallery
 * purely because it happened to be large.
 *
 * These tests pin the corrected contract end to end:
 *
 *   - the plan contract REQUIRES an allowlisted purpose, refused before any
 *     archive row, signed part target or private Storage path exists;
 *   - the purpose is stored durably on the archive, so retry, resume, browser
 *     close and process restart all read it back from the server;
 *   - a Full Project Archive still classifies its own entries;
 *   - an archive filed under ANY other window hands that window down to every
 *     entry, and the entries' filenames may not override it;
 *   - byte safety is unchanged: incompatible entries stay private with a
 *     truthful warning and are never re-filed under a window that would accept
 *     them;
 *   - two archives that differ only in the window they were filed under stay
 *     distinct, and a retry may not change the window of one that exists.
 */

import { describe, expect, it } from "vitest";

import { archiveMaterialPurpose } from "../server/large-archive";
import {
  confirmJobArchiveUpload,
  planJobArchiveUpload,
  processUploadJob,
  startUploadJob,
} from "../server/service";
import type { StudioMaterialPurpose } from "../studio-types";
import { magicBytesFor, makeWorld, OWNER, type FakeWorld } from "./fakes";
import {
  buildZipParts,
  manifestForParts,
  startArchiveJob,
  uploadArchiveParts,
  type StreamedZipEntry,
} from "./large-archive-fixtures";

const PART = 8 * 1024 * 1024;

function jpegEntry(name: string): StreamedZipEntry {
  return { name, data: () => magicBytesFor(name.split("/").pop() ?? name) };
}

/**
 * Entries whose FILENAMES each classify as something specific and different,
 * so any result that matches the outer window cannot be a coincidence.
 */
function misleadingEntries(): StreamedZipEntry[] {
  return [
    jpegEntry("floor-plans/level-2.jpg"),
    jpegEntry("master-plan/site.jpg"),
    jpegEntry("photos/render-front.jpg"),
  ];
}

async function drive(world: FakeWorld, jobId: string, maxCalls = 80) {
  for (let calls = 0; calls <= maxCalls; calls += 1) {
    const result = await processUploadJob(world.deps, OWNER, jobId);
    if (result.status !== "processing") return result;
  }
  throw new Error(`job did not settle within ${maxCalls} slices`);
}

async function uploadArchive(
  world: FakeWorld,
  jobId: string,
  fileName: string,
  entries: StreamedZipEntry[],
  materialPurpose: StudioMaterialPurpose,
) {
  const { parts, totalSize } = buildZipParts(entries, PART);
  return uploadArchiveParts(world, OWNER, jobId, fileName, parts, totalSize, { materialPurpose });
}

/** Every entry row of one job, as (name → routed category). */
async function entryCategories(world: FakeWorld, jobId: string): Promise<Record<string, string>> {
  const entries = await world.data.listJobArchiveEntries(jobId);
  return Object.fromEntries(entries.map((entry) => [entry.entry_name, entry.category]));
}

describe("large-archive transport — the plan contract requires an Owner window", () => {
  it("refuses a missing, blank, null or unknown purpose before ANY allocation", async () => {
    const cases: Array<[unknown, string]> = [
      [undefined, "material_purpose_required"],
      [null, "material_purpose_required"],
      ["", "material_purpose_required"],
      ["   ", "material_purpose_required"],
      ["not_a_window", "material_purpose_invalid"],
      ["PROJECT_ARCHIVE", "material_purpose_invalid"],
      [42, "material_purpose_invalid"],
      [{ purpose: "project_archive" }, "material_purpose_invalid"],
    ];
    for (const [value, code] of cases) {
      const world = makeWorld();
      const jobId = await startArchiveJob(world, OWNER);
      const signedBefore = world.storage.signedUploads.length;
      await expect(
        planJobArchiveUpload(world.deps, OWNER, {
          jobId,
          fileName: "package.zip",
          declaredSize: PART,
          materialPurpose: value as StudioMaterialPurpose,
          partSha256: [`${"a".repeat(64)}`],
        }),
        String(value),
      ).rejects.toMatchObject({ code });
      // No archive row, no signed part target, no private Storage path.
      expect(world.data.archives.size, String(value)).toBe(0);
      expect(world.storage.signedUploads.length, String(value)).toBe(signedBefore);
      expect(world.storage.objects.size, String(value)).toBe(0);
    }
  });

  it("stores the Owner's window durably on the archive at plan time", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const uploaded = await uploadArchive(
      world,
      jobId,
      "documents.zip",
      misleadingEntries(),
      "document_legal",
    );
    const archive = await world.data.getArchive(uploaded.archiveId);
    expect(archiveMaterialPurpose(archive!)).toBe("document_legal");
    expect(archive!.extracted?.purposeSource).toBe("owner_selected");
  });

  it("keeps the window available with no browser and no request in flight", async () => {
    // Durability is the point: this reads the purpose back through a fresh
    // server-side lookup, which is exactly what a retry, a scheduled worker or
    // a resume after the browser was closed does.
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const uploaded = await uploadArchive(
      world,
      jobId,
      "photos.zip",
      misleadingEntries(),
      "project_photo",
    );
    const archives = await world.data.listJobArchives(jobId);
    expect(archives.map((archive) => archiveMaterialPurpose(archive))).toEqual(["project_photo"]);
    expect(uploaded.archiveId).toBe(archives[0].id);
  });
});

describe("large-archive transport — entry routing (the two explicit cases)", () => {
  it("CASE A — a Full Project Archive still classifies its own entries", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    await uploadArchive(world, jobId, "package.zip", misleadingEntries(), "project_archive");
    await drive(world, jobId);

    expect(await entryCategories(world, jobId)).toEqual({
      "floor-plans/level-2.jpg": "floor-plan",
      "master-plan/site.jpg": "master-plan",
      "photos/render-front.jpg": "photo",
    });
    const types = world.executor.store.media.map((item) => item.media_type).sort();
    expect(types).toEqual(["floor_plan", "gallery", "master_plan"]);
  });

  it("CASE B — a non-archive window is inherited by every entry", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    await uploadArchive(world, jobId, "photos.zip", misleadingEntries(), "project_photo");
    await drive(world, jobId);

    // Filename, folder name and extension all lost to the Owner's window.
    expect(await entryCategories(world, jobId)).toEqual({
      "floor-plans/level-2.jpg": "photo",
      "master-plan/site.jpg": "photo",
      "photos/render-front.jpg": "photo",
    });
    const types = world.executor.store.media.map((item) => item.media_type).sort();
    expect(types).toEqual(["gallery", "gallery", "gallery"]);
  });

  it("CASE B — Documents / Legal keeps every entry private instead of publishing it", async () => {
    // The exact defect F1 described: before the correction these images
    // published into the anonymously readable gallery because the archive was
    // large. Under the Owner's window they are legal documents, and legal
    // documents are retained privately.
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    await uploadArchive(world, jobId, "documents.zip", misleadingEntries(), "document_legal");
    const result = await drive(world, jobId);

    expect(result.status).toBe("published");
    expect(Object.values(await entryCategories(world, jobId))).toEqual([
      "legal-document",
      "legal-document",
      "legal-document",
    ]);
    expect(world.executor.store.media).toHaveLength(0);
    const entries = await world.data.listJobArchiveEntries(jobId);
    expect(entries.every((entry) => entry.state === "retained_private")).toBe(true);
    expect(entries.every((entry) => entry.public_url === null)).toBe(true);
  });

  it("CASE B — the SAME bytes take opposite routes under two different windows", async () => {
    // One controlled comparison: identical entries, identical archive filename,
    // only the chosen window differs.
    const outcomes: Array<{ purpose: StudioMaterialPurpose; types: string[] }> = [];
    for (const purpose of ["project_photo", "document_legal"] as const) {
      const world = makeWorld();
      const jobId = await startArchiveJob(world, OWNER);
      await uploadArchive(world, jobId, "same-name.zip", misleadingEntries(), purpose);
      await drive(world, jobId);
      outcomes.push({
        purpose,
        types: world.executor.store.media.map((item) => item.media_type).sort(),
      });
    }
    expect(outcomes[0].types).toEqual(["gallery", "gallery", "gallery"]);
    expect(outcomes[1].types).toEqual([]);
  });

  it("keeps byte safety in charge: an inherited window never publishes wrong bytes", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    await uploadArchive(
      world,
      jobId,
      "photos.zip",
      [
        jpegEntry("photos/real.jpg"),
        // A PDF wearing a .jpg name, inside an archive filed under photos.
        { name: "photos/actually-a-pdf.jpg", data: () => Buffer.from("%PDF-1.4\n%fake\n") },
      ],
      "project_photo",
    );
    const result = await drive(world, jobId);

    expect(result.status).toBe("published");
    // The good photo published; the incompatible entry stayed private with a
    // truthful warning and was NOT re-filed under a document window.
    expect(world.executor.store.media).toHaveLength(1);
    const entries = await world.data.listJobArchiveEntries(jobId);
    const bad = entries.find((entry) => entry.entry_name.endsWith("actually-a-pdf.jpg"))!;
    expect(bad.state).toBe("retained_private");
    expect(bad.outcome_code).toBe("media_class_mismatch");
    expect(bad.category).toBe("photo");
    expect(bad.public_url).toBeNull();
    expect(result.warnings.some((warning) => warning.code === "media_class_mismatch")).toBe(true);
  });
});

describe("large-archive transport — retry, resume and identity", () => {
  it("re-planning the same archive resumes it and keeps the stored window", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const entries = misleadingEntries();
    const { parts, totalSize } = buildZipParts(entries, PART);
    const manifest = manifestForParts(parts);

    const first = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "photos.zip",
      declaredSize: totalSize,
      materialPurpose: "project_photo",
      partSha256: manifest,
    });
    // Only some parts arrive, then the browser is closed and comes back.
    world.storage.put(first.parts[0].bucket, first.parts[0].path, Buffer.from(parts[0]));
    const second = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "photos.zip",
      declaredSize: totalSize,
      materialPurpose: "project_photo",
      partSha256: manifest,
    });
    expect(second.archiveId).toBe(first.archiveId);
    expect(second.presentParts).toContain(0);
    const archive = await world.data.getArchive(second.archiveId);
    expect(archiveMaterialPurpose(archive!)).toBe("project_photo");
    expect(world.data.archives.size).toBe(1);
  });

  it("REFUSES a retry that submits a different window for the same archive", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { parts, totalSize } = buildZipParts(misleadingEntries(), PART);
    const manifest = manifestForParts(parts);
    const planned = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "photos.zip",
      declaredSize: totalSize,
      materialPurpose: "project_photo",
      partSha256: manifest,
    });

    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "photos.zip",
        declaredSize: totalSize,
        materialPurpose: "document_legal",
        partSha256: manifest,
      }),
    ).rejects.toMatchObject({ code: "archive_purpose_conflict" });

    // The stored window is untouched and no second archive was created.
    const archive = await world.data.getArchive(planned.archiveId);
    expect(archiveMaterialPurpose(archive!)).toBe("project_photo");
    expect(world.data.archives.size).toBe(1);
  });

  it("keeps two same-named archives with different contents and windows distinct", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const photos = await uploadArchive(
      world,
      jobId,
      "package.zip",
      [jpegEntry("a/one.jpg")],
      "project_photo",
    );
    const documents = await uploadArchive(
      world,
      jobId,
      "package.zip",
      [jpegEntry("b/two.jpg")],
      "document_legal",
    );
    expect(documents.archiveId).not.toBe(photos.archiveId);

    const archives = await world.data.listJobArchives(jobId);
    expect(archives.map((archive) => archiveMaterialPurpose(archive))).toEqual([
      "project_photo",
      "document_legal",
    ]);

    await drive(world, jobId);
    const entries = await world.data.listJobArchiveEntries(jobId);
    const byName = Object.fromEntries(entries.map((entry) => [entry.entry_name, entry.category]));
    expect(byName).toEqual({ "a/one.jpg": "photo", "b/two.jpg": "legal-document" });
  });

  it("does not depend on plan order: the second archive's window is its own", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    await uploadArchive(world, jobId, "first.zip", [jpegEntry("x/one.jpg")], "document_legal");
    await uploadArchive(world, jobId, "second.zip", [jpegEntry("y/two.jpg")], "project_photo");
    await drive(world, jobId);

    const entries = await world.data.listJobArchiveEntries(jobId);
    const byName = Object.fromEntries(entries.map((entry) => [entry.entry_name, entry.category]));
    expect(byName).toEqual({ "x/one.jpg": "legal-document", "y/two.jpg": "photo" });
  });

  it("processes a pre-contract archive with no recorded window through the classifier", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const uploaded = await uploadArchive(
      world,
      jobId,
      "legacy.zip",
      misleadingEntries(),
      "project_archive",
    );
    // Simulate a row planned before this contract existed: strip the recorded
    // window from the STORED archive, exactly as an old row would read back.
    const stored = world.data.archives.get(uploaded.archiveId)!;
    stored.extracted = null;
    expect(archiveMaterialPurpose((await world.data.getArchive(uploaded.archiveId))!)).toBeNull();

    await drive(world, jobId);
    expect(await entryCategories(world, jobId)).toEqual({
      "floor-plans/level-2.jpg": "floor-plan",
      "master-plan/site.jpg": "master-plan",
      "photos/render-front.jpg": "photo",
    });
  });
});

describe("large-archive transport — the lane itself carries no meaning", () => {
  it("routes the same ZIP identically whether it is inline-small or chunked-large", async () => {
    // The inline lane (a ZIP under the 16 MiB cap, declared in the job's file
    // manifest) and the chunked lane (above it) must agree about what the
    // material IS. Both are given the SAME entries under the SAME window.
    const entries = misleadingEntries();

    const large = makeWorld();
    const largeJob = await startArchiveJob(large, OWNER);
    await uploadArchive(large, largeJob, "photos.zip", entries, "project_photo");
    await drive(large, largeJob);

    const small = makeWorld();
    small.archives.set("photos.zip", [
      { name: "floor-plans/level-2.jpg", data: magicBytesFor("level-2.jpg") },
      { name: "master-plan/site.jpg", data: magicBytesFor("site.jpg") },
      { name: "photos/render-front.jpg", data: magicBytesFor("render-front.jpg") },
    ]);
    const started = await startUploadJob(small.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Small Lane" },
      files: [{ name: "photos.zip", size: 1024, materialPurpose: "project_photo" }],
    });
    // A real ZIP header so the observed bytes agree with the .zip name.
    small.storage.put(
      started.uploads[0].bucket,
      started.uploads[0].path,
      Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]),
    );
    const smallResult = await processUploadJob(small.deps, OWNER, started.jobId);
    expect(smallResult.status).toBe("published");

    const typesOf = (world: FakeWorld) =>
      world.executor.store.media.map((item) => item.media_type).sort();
    expect(typesOf(small)).toEqual(["gallery", "gallery", "gallery"]);
    expect(typesOf(large)).toEqual(typesOf(small));
  });

  it("confirms an archive without ever re-stating its window", async () => {
    // Confirm carries bytes, not meaning: the window is already durable, so a
    // confirming client cannot change it.
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    const { parts, totalSize } = buildZipParts(misleadingEntries(), PART);
    const manifest = manifestForParts(parts);
    const plan = await planJobArchiveUpload(world.deps, OWNER, {
      jobId,
      fileName: "photos.zip",
      declaredSize: totalSize,
      materialPurpose: "project_photo",
      partSha256: manifest,
    });
    for (const target of plan.parts) {
      world.storage.put(target.bucket, target.path, Buffer.from(parts[target.index]));
    }
    const confirmed = await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId,
      archiveId: plan.archiveId,
      partSha256: manifest,
    });
    expect(confirmed.accepted).toBe(true);
    const archive = await world.data.getArchive(plan.archiveId);
    expect(archiveMaterialPurpose(archive!)).toBe("project_photo");
  });
});
