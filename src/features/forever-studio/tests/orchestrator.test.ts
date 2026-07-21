/**
 * FOREVER-STUDIO-001 — orchestrator behavioral tests.
 *
 * In-memory behavioral tests against the FakeIngestExecutor model of the
 * verified progressive RPC. They prove the canonical product rule end to
 * end: an authorized upload publishes directly, incomplete data publishes
 * what exists, an existing project is updated rather than duplicated,
 * retries are idempotent, and failures preserve a retryable job.
 *
 * The Coralina-like and Rainpalm-like proofs consume the committed
 * repository fixtures (forever-data/projects/...): no private Owner files,
 * no production connection.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  processUploadJob,
  saveProjectFacts,
  setProjectPublication,
  startUploadJob,
} from "../server/service";
import { StudioAccessError } from "../server/contracts";
import { makeWorld, uploadAll, OWNER, PUBLISHER, type FakeWorld } from "./fakes";

const CORALINA_PRICE_LIST = readFileSync(
  resolve(process.cwd(), "forever-data/projects/coralina/extracted/price-list.json"),
  "utf8",
);
const RAINPALM_PRICE_LIST = readFileSync(
  resolve(process.cwd(), "forever-data/projects/rainpalm-villas/sip/reviewed-price-list.json"),
  "utf8",
);

async function runJob(
  world: FakeWorld,
  actor: typeof OWNER,
  input: Parameters<typeof startUploadJob>[2],
  contents: Record<string, Buffer | string> = {},
) {
  const started = await startUploadJob(world.deps, actor, input);
  uploadAll(world, started.uploads, contents);
  const result = await processUploadJob(world.deps, actor, started.jobId);
  return { started, result };
}

describe("FOREVER-STUDIO-001 orchestrator", () => {
  it("publishes a Coralina-like new development directly from one upload", async () => {
    const world = makeWorld();
    const { result } = await runJob(
      world,
      OWNER,
      {
        workflow: "new_development",
        projectFacts: {
          name: "The Title Coralina Kamala",
          developerName: "Rhom Bho Property Public Company Limited",
          locationText: "Kamala, Phuket, Thailand",
          projectType: "Residential",
        },
        files: [
          { name: "price-list.json" },
          { name: "render-front.jpg" },
          { name: "coralina-brochure.pdf" },
        ],
      },
      { "price-list.json": CORALINA_PRICE_LIST },
    );

    expect(result.status).toBe("published");
    expect(result.projectSlug).toBe("the-title-coralina-kamala");
    expect(result.pagePath).toBe("/projects/the-title-coralina-kamala");
    // Direct publication: the row is publicly visible with NO follow-on gate.
    expect(result.publicStatus).toBe("published");
    expect(world.executor.publicProjects().map((row) => row.slug)).toContain(
      "the-title-coralina-kamala",
    );
    // The whole committed Coralina inventory landed in one atomic batch.
    expect(result.counts).toMatchObject({ buildings: 8, units: 198, prices: 198 });
    expect(world.executor.store.units).toHaveLength(198);
    expect(world.executor.store.prices).toHaveLength(198);
    // Uploaded photo and brochure became public media + blank-filled links.
    const project = world.executor.store.projects[0];
    expect(project.main_image_url).toMatch(/^https:\/\/cdn\.test\/project-images\//);
    expect(project.brochure_url).toMatch(/^https:\/\/cdn\.test\/project-documents\//);
    expect(world.executor.store.media.length).toBeGreaterThanOrEqual(2);
    // Provenance: manual owner entry is recorded as owner_verified.
    expect((project.field_provenance as Record<string, { status: string }>).name.status).toBe(
      "owner_verified",
    );
    // Who did it is recorded.
    expect(world.data.audits.some((row) => row.action === "studio_project_created_published")).toBe(
      true,
    );
  });

  it("publishes a Rainpalm-like incomplete project with warnings, never a gate", async () => {
    const world = makeWorld();
    const { result } = await runJob(
      world,
      PUBLISHER,
      {
        workflow: "new_development",
        projectFacts: { name: "Rainpalm Villas", locationText: "Bang Tao, Phuket" },
        files: [{ name: "price-list.json" }],
      },
      { "price-list.json": RAINPALM_PRICE_LIST },
    );

    expect(result.status).toBe("published");
    expect(result.publicStatus).toBe("published");
    // 21 units but only 9 source-backed prices: the missing 12 are warnings,
    // absent rows — not blockers.
    expect(result.counts?.units).toBe(21);
    expect(result.counts?.prices).toBe(9);
    expect(world.executor.store.prices).toHaveLength(9);
    expect(result.warnings.some((warning) => warning.code === "price_missing")).toBe(true);
    // No developer record existed: the raw name stays absent, location text kept.
    const project = world.executor.store.projects[0];
    expect(project.location_name_raw).toBe("Bang Tao, Phuket");
    expect(project.developer_id).toBeNull();
  });

  it("treats a repeat upload for an existing project as an update, not a duplicate", async () => {
    const world = makeWorld();
    await runJob(
      world,
      OWNER,
      {
        workflow: "new_development",
        projectFacts: { name: "Rainpalm Villas" },
        files: [{ name: "price-list.json" }],
      },
      { "price-list.json": RAINPALM_PRICE_LIST },
    );
    const { result } = await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Rainpalm Villas", developerName: "Tonsai Company" },
      files: [{ name: "pool-view.jpg" }],
    });

    expect(result.status).toBe("published");
    expect(result.warnings.some((warning) => warning.code === "project_exists_updated")).toBe(true);
    expect(world.executor.store.projects).toHaveLength(1);
    expect(world.executor.store.projects[0].developer_name_raw).toBe("Tonsai Company");
    // Media added, inventory untouched.
    expect(world.executor.store.units).toHaveLength(21);
  });

  it("applies a price/availability update to an existing published project", async () => {
    const world = makeWorld();
    await runJob(
      world,
      OWNER,
      {
        workflow: "new_development",
        projectFacts: { name: "Rainpalm Villas" },
        files: [{ name: "price-list.json" }],
      },
      { "price-list.json": RAINPALM_PRICE_LIST },
    );
    const updated = JSON.parse(RAINPALM_PRICE_LIST) as {
      unit_inventory: Array<Record<string, { value: unknown } | undefined>>;
    };
    const priced = updated.unit_inventory.find((row) => row.price?.value != null)!;
    (priced.price as { value: unknown }).value = 99_999_999;
    const { result } = await runJob(
      world,
      PUBLISHER,
      {
        workflow: "price_availability_update",
        projectSlug: "rainpalm-villas",
        files: [{ name: "price-list.json" }],
      },
      { "price-list.json": JSON.stringify(updated) },
    );

    expect(result.status).toBe("published");
    expect(world.executor.store.projects).toHaveLength(1);
    expect(world.executor.store.prices.some((row) => row.price === 99_999_999)).toBe(true);
    expect(world.executor.store.projects[0].public_status).toBe("published");
  });

  it("publishes construction media updates as dated gallery items", async () => {
    const world = makeWorld();
    await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Rainpalm Villas" },
      files: [],
    });
    const { result } = await runJob(world, PUBLISHER, {
      workflow: "construction_media_update",
      projectSlug: "rainpalm-villas",
      files: [{ name: "IMG_2201.jpg" }, { name: "IMG_2202.jpg" }],
    });

    expect(result.status).toBe("published");
    const gallery = world.executor.store.media.filter((row) => row.media_type === "gallery");
    expect(gallery).toHaveLength(2);
    expect(gallery[0].title).toMatch(/^Construction update \d{4}-\d{2}-\d{2}$/);
  });

  it("continues past unreadable and missing files, retaining them", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Partial Project" },
      files: [
        { name: "broken-price-list.json" },
        { name: "render.jpg" },
        { name: "never-arrives.pdf" },
      ],
    });
    // Only two of three declared files actually arrive; one is corrupt JSON.
    uploadAll(world, started.uploads.slice(0, 2), {
      "broken-price-list.json": "{not-json",
    });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published");
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["file_unreadable", "file_upload_missing"]),
    );
    const job = await world.data.getJob(started.jobId);
    const statuses = Object.fromEntries(job!.files.map((file) => [file.name, file.status]));
    expect(statuses["broken-price-list.json"]).toBe("unreadable");
    expect(statuses["never-arrives.pdf"]).toBe("missing");
    expect(statuses["render.jpg"]).toBe("uploaded");
  });

  it("retains an unextractable price-list PDF and still publishes", async () => {
    const world = makeWorld();
    const { result } = await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Pdf Only Project" },
      files: [{ name: "Price List July.pdf" }],
    });
    expect(result.status).toBe("published");
    expect(
      result.warnings.some((warning) => warning.code === "price_list_extraction_unavailable"),
    ).toBe(true);
    expect(world.executor.store.units).toHaveLength(0);
    expect(world.executor.publicProjects()).toHaveLength(1);
  });

  it("keeps a failed job retryable and the retry idempotent", async () => {
    const world = makeWorld();
    world.executor.failOnUnitCode = "A101";
    const list: string = JSON.stringify({
      unit_inventory: [
        {
          unit_number: { value: "A101", source_file: "list.pdf", confidence: "high" },
          price: { value: "5,000,000", source_file: "list.pdf", confidence: "high" },
        },
      ],
    });
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Retry Project" },
      files: [{ name: "price-list.json" }],
    });
    uploadAll(world, started.uploads, { "price-list.json": list });

    const failed = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("injected_failure");
    // The transaction rolled back: nothing partial exists.
    expect(world.executor.store.projects).toHaveLength(0);
    const jobAfterFailure = await world.data.getJob(started.jobId);
    expect(jobAfterFailure?.status).toBe("failed");

    // Infrastructure recovers; the same job retries to full publication.
    world.executor.failOnUnitCode = null;
    const retried = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(retried.status).toBe("published");
    expect(world.executor.store.units).toHaveLength(1);

    // Re-entering a published job is a read, not a re-publication.
    const batchesAfter = world.executor.store.batches.length;
    const again = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(again.status).toBe("published");
    expect(world.executor.store.batches).toHaveLength(batchesAfter);
    expect(world.executor.store.units).toHaveLength(1);
  });

  it("isolates every write to the project addressed by the upload", async () => {
    const world = makeWorld();
    await runJob(
      world,
      OWNER,
      {
        workflow: "new_development",
        projectFacts: { name: "Project Alpha" },
        files: [{ name: "price-list.json" }],
      },
      { "price-list.json": RAINPALM_PRICE_LIST },
    );
    const alphaUnits = world.executor.store.units.length;
    const alphaProjectId = world.executor.store.projects[0].id;

    await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Project Beta" },
      files: [{ name: "beta-photo.jpg" }],
    });

    const beta = world.executor.store.projects.find((row) => row.slug === "project-beta")!;
    expect(world.executor.store.units.filter((row) => row.project_id === beta.id)).toHaveLength(0);
    expect(
      world.executor.store.units.filter((row) => row.project_id === alphaProjectId),
    ).toHaveLength(alphaUnits);
    expect(
      world.executor.store.media.filter((row) => row.project_id === alphaProjectId),
    ).toHaveLength(0);
  });

  it("supports explicit unpublish and republish from the result actions", async () => {
    const world = makeWorld();
    await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Toggle Project" },
      files: [],
    });
    expect(world.executor.publicProjects()).toHaveLength(1);

    const down = await setProjectPublication(world.deps, OWNER, {
      slug: "toggle-project",
      publish: false,
    });
    expect(down.publicStatus).toBe("draft");
    expect(world.executor.publicProjects()).toHaveLength(0);

    world.flags.nowValue = "2026-07-21T10:00:00.000Z";
    const up = await setProjectPublication(world.deps, OWNER, {
      slug: "toggle-project",
      publish: true,
    });
    expect(up.publicStatus).toBe("published");
    expect(world.executor.publicProjects()).toHaveLength(1);
  });

  it("lets later manual edits fill blanks while respecting owner-verified fields", async () => {
    const world = makeWorld();
    await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Edited Project", shortDescription: "Owner text" },
      files: [],
    });
    // A publisher's later edit fills a blank but cannot overwrite the
    // Owner-verified description.
    const outcome = await saveProjectFacts(world.deps, PUBLISHER, {
      slug: "edited-project",
      facts: { shortDescription: "Publisher text", projectType: "Condominium" },
    });
    const project = world.executor.store.projects[0];
    expect(project.project_type).toBe("Condominium");
    expect(project.short_description).toBe("Owner text");
    expect(outcome.warnings.some((warning) => warning.code === "field_conflict")).toBe(true);
  });

  it("expands ZIP archives and routes their contents", async () => {
    const world = makeWorld();
    world.archives.set("dossier.zip", [
      { name: "photos/render-1.jpg", data: Buffer.from("img") },
      { name: "brochure/main-brochure.pdf", data: Buffer.from("pdf") },
      { name: "price-list/price-list.json", data: Buffer.from(RAINPALM_PRICE_LIST) },
    ]);
    const { result } = await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Zip Project" },
      files: [{ name: "dossier.zip" }],
    });
    expect(result.status).toBe("published");
    expect(result.counts?.units).toBe(21);
    const mediaTypes = world.executor.store.media.map((row) => row.media_type).sort();
    expect(mediaTypes).toEqual(["brochure", "gallery"]);
  });

  it("requires a project identity but nothing else", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      files: [{ name: "photo.jpg" }],
    });
    uploadAll(world, started.uploads);
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("project name");
    // The job (and its uploaded file) survive for a later retry.
    const job = await world.data.getJob(started.jobId);
    expect(job?.status).toBe("failed");
  });

  it("creates the project when an update targets a slug that does not exist yet", async () => {
    const world = makeWorld();
    const { result } = await runJob(world, OWNER, {
      workflow: "project_update",
      projectSlug: "brand-new-slug",
      files: [{ name: "photo.jpg" }],
    });
    expect(result.status).toBe("published");
    expect(result.warnings.some((warning) => warning.code === "project_missing_created")).toBe(
      true,
    );
    expect(result.warnings.some((warning) => warning.code === "project_name_derived")).toBe(true);
    expect(world.executor.store.projects[0].name).toBe("Brand New Slug");
  });

  it("is fully disabled while Partner Demo mode is active", async () => {
    const world = makeWorld();
    world.flags.partnerDemo = true;
    await expect(
      startUploadJob(world.deps, OWNER, { workflow: "new_development", files: [] }),
    ).rejects.toMatchObject({ code: "studio_disabled_in_partner_demo" });
    await expect(
      setProjectPublication(world.deps, OWNER, { slug: "x", publish: true }),
    ).rejects.toBeInstanceOf(StudioAccessError);
  });

  it("routes uploads to the right buckets and keeps sources private", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Bucket Project" },
      files: [
        { name: "photo.jpg" },
        { name: "walkthrough.mp4" },
        { name: "Master Plan 2026.pdf" },
        { name: "Price List July.pdf" },
        { name: "dossier.zip" },
        { name: "unclassifiable.bin" },
      ],
    });
    const byName = Object.fromEntries(started.uploads.map((u) => [u.name, u.bucket]));
    expect(byName["photo.jpg"]).toBe("project-images");
    expect(byName["walkthrough.mp4"]).toBe("project-images");
    expect(byName["Master Plan 2026.pdf"]).toBe("project-documents");
    expect(byName["Price List July.pdf"]).toBe("studio-uploads");
    expect(byName["dossier.zip"]).toBe("studio-uploads");
    expect(byName["unclassifiable.bin"]).toBe("studio-uploads");
    // Storage paths are server-generated and job-scoped: no client path input.
    for (const upload of started.uploads) {
      expect(upload.path).toMatch(new RegExp(`^jobs/${started.jobId}/\\d{2}-[a-z0-9._-]+$`));
    }
  });
});
