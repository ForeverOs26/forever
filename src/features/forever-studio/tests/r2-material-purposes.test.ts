/**
 * FOREVER-R2-MEDIA-STORAGE-CUTOVER-001 — the fourteen material windows on R2.
 *
 * Moving the bytes to Cloudflare R2 must change NOTHING about what a file is.
 * The window the Owner chose stays authoritative, the filename is still never
 * consulted for a direct upload, and the structured-artifact matrix is
 * unchanged — on both transport lanes.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  confirmJobArchiveUpload,
  planJobArchiveUpload,
  processUploadJob,
  startUploadJob,
} from "../server/service";
import {
  ARCHIVE_PART_BYTES,
  STUDIO_MATERIAL_PURPOSES,
  type StudioMaterialPurpose,
} from "../studio-types";
import { buildZipParts } from "./large-archive-fixtures";
import { assertLocalR2Endpoint } from "./local-r2";
import {
  magicBytesFor,
  makeWorld,
  OWNER,
  TEST_R2_BUCKETS,
  uploadAllViaTransport,
  type FakeWorld,
} from "./fakes";

/** The committed repository price-list fixture: no private Owner file. */
const RAINPALM_PRICE_LIST = readFileSync(
  resolve(process.cwd(), "forever-data/projects/rainpalm-villas/sip/reviewed-price-list.json"),
  "utf8",
);

function r2World(): FakeWorld {
  const world = makeWorld();
  assertLocalR2Endpoint(world.r2.endpoint);
  world.flags.writeProvider = "r2";
  return world;
}

function buildZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const built = buildZipParts(
    entries.map((entry) => ({ name: entry.name, data: () => entry.data })),
    ARCHIVE_PART_BYTES,
  );
  return Buffer.concat(built.parts);
}

async function sha256Hex(data: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(data).digest("hex");
}

/** A filename whose extension DISAGREES with the window, on purpose. */
const CONTRARY_NAME: Record<StudioMaterialPurpose, string> = {
  brochure: "price-list.pdf",
  price_list: "brochure.json",
  payment_plan: "floor-plan.pdf",
  project_photo: "master-plan.jpg",
  video: "brochure.mp4",
  master_plan: "photo.pdf",
  floor_plan: "brochure.pdf",
  unit_plan: "map.pdf",
  construction_photo: "brochure.jpg",
  construction_video: "photo.mp4",
  document_legal: "price-list.pdf",
  developer_profile: "floor-plan.pdf",
  map_location: "brochure.pdf",
  project_archive: "photos.zip",
};

describe("all fourteen windows on the R2 direct lane", () => {
  it("preserves every Owner-selected purpose, and never re-derives one from a filename", async () => {
    const world = r2World();
    const files = STUDIO_MATERIAL_PURPOSES.map((purpose) => ({
      name: CONTRARY_NAME[purpose],
      materialPurpose: purpose,
    }));
    expect(files).toHaveLength(14);

    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "R2 Fourteen Windows" },
      files,
    });
    expect(started.uploads).toHaveLength(14);
    const contents: Record<string, Buffer> = {};
    for (const [index, file] of files.entries()) {
      // Distinct bytes per file so nothing is treated as a duplicate.
      contents[file.name] = Buffer.concat([
        magicBytesFor(file.name),
        Buffer.from(`::${file.materialPurpose}::${index}`),
      ]);
    }
    // One ZIP filed under project_archive uses the inline lane; give it a
    // genuinely valid archive so it expands rather than being retained.
    contents["photos.zip"] = buildZip([
      { name: "gallery/one.jpg", data: magicBytesFor("archive-one.jpg") },
    ]);

    await uploadAllViaTransport(world, started.uploads, contents);
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("completed");

    const job = await world.deps.data.getJob(started.jobId);
    expect(job!.files).toHaveLength(14);
    for (const file of job!.files) {
      // The window survived the whole R2 round trip, untouched.
      expect(file.purposeSource).toBe("owner_selected");
      expect(STUDIO_MATERIAL_PURPOSES).toContain(file.materialPurpose);
      expect(file.storageProvider).toBe("r2");
      // Every private key is server-generated and carries no filename.
      expect(file.stagingPath).toMatch(/^jobs\/[^/]+\/staging\/\d{3}\/object$/);
    }
    // Each purpose appears exactly once, in the order it was declared.
    expect(job!.files.map((file) => file.materialPurpose)).toEqual([...STUDIO_MATERIAL_PURPOSES]);

    // Zero Supabase Storage involvement for any of the fourteen.
    expect(world.storage.uploadCalls).toEqual([]);
    expect(world.storage.signedUploads).toEqual([]);
  });

  it("keeps documents, price files and archives out of the public bucket", async () => {
    const world = r2World();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "R2 Private Material" },
      files: [
        { name: "contract.pdf", materialPurpose: "document_legal" },
        { name: "prices.pdf", materialPurpose: "price_list" },
        { name: "package.zip", materialPurpose: "project_archive" },
        { name: "clip.mp4", materialPurpose: "video" },
      ],
    });
    await uploadAllViaTransport(world, started.uploads, {
      "package.zip": buildZip([{ name: "readme.txt", data: Buffer.from("notes") }]),
    });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("completed");

    // Nothing here has a safe public derivative: the public bucket stays empty.
    expect(world.r2.keys(TEST_R2_BUCKETS.publicMedia)).toEqual([]);
    // Every original is retained privately.
    expect(world.r2.keys(TEST_R2_BUCKETS.privateSources).length).toBeGreaterThanOrEqual(4);
  });
});

describe("structured artifacts still obey the window that admitted them", () => {
  it("adopts a price list filed under Price List", async () => {
    const world = r2World();
    const priceList = Buffer.from(RAINPALM_PRICE_LIST);
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "R2 Price Admission" },
      // The filename says nothing about prices; the WINDOW does.
      files: [{ name: "document.json", materialPurpose: "price_list" }],
    });
    await uploadAllViaTransport(world, started.uploads, { "document.json": priceList });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("completed");
    expect(world.executor.store.prices.length).toBeGreaterThan(0);
  });

  it("refuses the same bytes filed under a window that admits nothing", async () => {
    const world = r2World();
    const priceList = Buffer.from(RAINPALM_PRICE_LIST);
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "R2 Price Mismatch" },
      // A price-list-shaped file dropped into Project Photos is a private
      // photo-window file that happens to contain JSON.
      files: [{ name: "price-list.json", materialPurpose: "project_photo" }],
    });
    await uploadAllViaTransport(world, started.uploads, { "price-list.json": priceList });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("completed");
    expect(result.warnings.map((warning) => warning.code)).toContain("structured_purpose_mismatch");
    expect(world.executor.store.prices).toHaveLength(0);
    // The refusal names no filename and no storage location.
    for (const warning of result.warnings) {
      expect(warning.message).not.toContain("price-list.json");
      expect(warning.message).not.toContain(TEST_R2_BUCKETS.privateSources);
    }
  });
});

describe("a ZIP under a NON-archive window, on the resumable lane", () => {
  it("hands the Owner's window down to every entry across both transports", async () => {
    const world = r2World();
    const archive = buildZip([
      { name: "some-name.jpg", data: magicBytesFor("plan-a.jpg") },
      { name: "another.jpg", data: magicBytesFor("plan-b.jpg") },
    ]);
    const job = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "R2 Inherited Window" },
      files: [],
    });
    const partSha256 = [await sha256Hex(archive)];
    const plan = await planJobArchiveUpload(world.deps, OWNER, {
      jobId: job.jobId,
      fileName: "unit-plans.zip",
      declaredSize: archive.length,
      // NOT the archive window: every entry must inherit Unit Plans.
      materialPurpose: "unit_plan",
      partSha256,
    });
    const transport = plan.parts[0].transport!;
    if (transport.kind !== "r2_presigned_put") throw new Error("expected an R2 transport");
    const response = await world.r2.fetchImpl(transport.url, {
      method: "PUT",
      headers: transport.headers,
      body: new Uint8Array(archive) as unknown as BodyInit,
    });
    expect(response.ok).toBe(true);
    const confirmed = await confirmJobArchiveUpload(world.deps, OWNER, {
      jobId: job.jobId,
      archiveId: plan.archiveId,
      partSha256,
      partEtags: [{ index: 0, etag: (response.headers.get("etag") ?? "").replace(/"/g, "") }],
    });
    expect(confirmed.accepted).toBe(true);

    let result = await processUploadJob(world.deps, OWNER, job.jobId);
    for (let round = 0; round < 12 && result.status === "processing"; round += 1) {
      result = await processUploadJob(world.deps, OWNER, job.jobId);
    }
    expect(result.status).toBe("completed");

    const entries = await world.deps.data.listArchiveEntries(plan.archiveId);
    expect(entries).toHaveLength(2);
    // Inherited, NOT re-guessed from the entry filenames.
    for (const entry of entries) expect(entry.category).toBe("unit-plan");
  });
});
