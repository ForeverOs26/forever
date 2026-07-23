/**
 * FOREVER-STUDIO-001 — orchestrator behavioral tests (hardened).
 *
 * In-memory behavioral tests against the FakeIngestExecutor model of the
 * progressive RPC and a snapshot/rollback model of the studio_* transaction
 * functions. They prove the canonical product rule end to end AND the
 * corrective invariants: atomic ingest+publish, single-winner claim, rollback
 * on failure, idempotent retry, staging→public media, no-name upload, and
 * project isolation. The real SQL is additionally covered by studio.postgres.sql.
 *
 * Coralina-like and Rainpalm-like proofs consume the committed repository
 * fixtures: no private Owner files, no production connection.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PRIVATE_SOURCE_BUCKET, PUBLIC_IMAGE_BUCKET } from "../server/extraction";
import { processUploadJob, setProjectPublication, startUploadJob } from "../server/service";
import { makeWorld, tinyJpeg, uploadAll, OWNER, PUBLISHER, type FakeWorld } from "./fakes";

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
    const { started, result } = await runJob(
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
    // Direct publication with NO follow-on gate.
    expect(result.publicStatus).toBe("published");
    expect(world.executor.publicProjects().map((row) => row.slug)).toContain(
      "the-title-coralina-kamala",
    );
    // Whole committed Coralina inventory in one atomic batch.
    expect(result.counts).toMatchObject({ buildings: 8, units: 198, prices: 198 });
    expect(world.executor.store.units).toHaveLength(198);
    // Every file was uploaded to PRIVATE staging (item 4).
    for (const upload of started.uploads) expect(upload.bucket).toBe(PRIVATE_SOURCE_BUCKET);
    // The sanitized image is public; PDF metadata cannot yet be safely rewritten.
    const project = world.executor.store.projects[0];
    expect(project.main_image_url).toMatch(/^https:\/\/cdn\.test\/project-images\//);
    expect(project.brochure_url).toBeNull();
    expect(
      result.warnings.some((warning) => warning.code === "media_sanitization_unsupported"),
    ).toBe(true);
    // Provenance: an ordinary Owner entry is owner_provided, NEVER owner_verified.
    const provenance = project.field_provenance as Record<string, { status: string }>;
    expect(provenance.name.status).toBe("owner_provided");
    expect(provenance.name.status).not.toBe("owner_verified");
    // Ordinary Studio input never claims Forever-verified.
    expect(project.forever_verified).toBe(false);
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
    expect(result.counts?.units).toBe(21);
    expect(result.counts?.prices).toBe(9);
    expect(result.warnings.some((warning) => warning.code === "price_missing")).toBe(true);
    const project = world.executor.store.projects[0];
    expect(project.location_name_raw).toBe("Bang Tao, Phuket");
    expect(project.developer_id).toBeNull();
    // Publisher input is trusted_publisher_provided, not owner or verified.
    const provenance = project.field_provenance as Record<string, { status: string }>;
    expect(provenance.name.status).toBe("trusted_publisher_provided");
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
      OWNER,
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
  });

  it("publishes construction media updates as dated gallery items", async () => {
    const world = makeWorld();
    await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Rainpalm Villas" },
      files: [],
    });
    const { result } = await runJob(world, OWNER, {
      workflow: "construction_media_update",
      projectSlug: "rainpalm-villas",
      files: [{ name: "IMG_2201.jpg" }, { name: "IMG_2202.jpg" }],
    });

    expect(result.status).toBe("published");
    const gallery = world.executor.store.media.filter((row) => row.media_type === "gallery");
    expect(gallery).toHaveLength(2);
    expect(gallery[0].title).toMatch(/^Construction update \d{4}-\d{2}-\d{2}$/);
  });

  it("lets the current Owner run every update workflow on a Publisher-owned project", async () => {
    const world = makeWorld();
    const created = await runJob(
      world,
      PUBLISHER,
      {
        workflow: "new_development",
        projectFacts: { name: "Rainpalm Villas" },
        files: [{ name: "price-list.json" }],
      },
      { "price-list.json": RAINPALM_PRICE_LIST },
    );
    const project = world.executor.store.projects[0];
    expect(world.data.objectOwners.get(`project:${project.id}`)).toBe(PUBLISHER.userId);

    const facts = await runJob(world, OWNER, {
      workflow: "project_update",
      projectSlug: "rainpalm-villas",
      projectFacts: { shortDescription: "Owner-managed publisher project" },
      files: [],
    });
    expect(facts.result.status).toBe("published");

    const updated = JSON.parse(RAINPALM_PRICE_LIST) as {
      unit_inventory: Array<Record<string, { value: unknown } | undefined>>;
    };
    const priced = updated.unit_inventory.find((row) => row.price?.value != null)!;
    (priced.price as { value: unknown }).value = 88_888_888;
    const prices = await runJob(
      world,
      OWNER,
      {
        workflow: "price_availability_update",
        projectSlug: "rainpalm-villas",
        files: [{ name: "price-list.json" }],
      },
      { "price-list.json": JSON.stringify(updated) },
    );
    expect(prices.result.status).toBe("published");
    expect(world.executor.store.prices.some((row) => row.price === 88_888_888)).toBe(true);

    const media = await runJob(
      world,
      OWNER,
      {
        workflow: "construction_media_update",
        projectSlug: "rainpalm-villas",
        files: [{ name: "owner-update-1.jpg" }, { name: "owner-update-2.jpg" }],
      },
      {
        "owner-update-1.jpg": tinyJpeg(),
        "owner-update-2.jpg": Buffer.concat([tinyJpeg(), Buffer.from("second")]),
      },
    );
    expect(media.result.status).toBe("published");

    const counts = {
      projects: world.executor.store.projects.length,
      units: world.executor.store.units.length,
      prices: world.executor.store.prices.length,
      media: world.executor.store.media.length,
      batches: world.executor.store.batches.length,
      warnings: world.executor.store.warnings.length,
    };
    for (const job of [created.started, facts.started, prices.started, media.started]) {
      expect((await processUploadJob(world.deps, OWNER, job.jobId)).status).toBe("published");
    }
    expect({
      projects: world.executor.store.projects.length,
      units: world.executor.store.units.length,
      prices: world.executor.store.prices.length,
      media: world.executor.store.media.length,
      batches: world.executor.store.batches.length,
      warnings: world.executor.store.warnings.length,
    }).toEqual(counts);
    expect(world.data.objectOwners.get(`project:${project.id}`)).toBe(PUBLISHER.userId);
  });

  it("continues past unreadable and missing files, retaining them privately", async () => {
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
    // Only two of three declared files arrive; one is corrupt JSON.
    uploadAll(world, started.uploads.slice(0, 2), { "broken-price-list.json": "{not-json" });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published");
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["file_unreadable", "file_upload_missing"]),
    );
    const job = await world.data.getJob(started.jobId);
    const statuses = Object.fromEntries(job!.files.map((f) => [f.name, f.status]));
    expect(statuses["broken-price-list.json"]).toBe("unreadable");
    expect(statuses["never-arrives.pdf"]).toBe("missing");
  });

  it("rolls the whole operation back when the graph write fails (no partial project)", async () => {
    const world = makeWorld();
    world.executor.failOnUnitCode = "A101";
    const list = JSON.stringify({
      unit_inventory: [
        {
          unit_number: { value: "A101", source_file: "list.pdf", confidence: "high" },
          price: { value: "5,000,000", source_file: "list.pdf", confidence: "high" },
        },
      ],
    });
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Rollback Project" },
      files: [{ name: "price-list.json" }],
    });
    uploadAll(world, started.uploads, { "price-list.json": list });

    const failed = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(failed.status).toBe("failed");
    expect(failed.retryable).toBe(true);
    // Nothing partial: no project, no children, no batch, no public page.
    expect(world.executor.store.projects).toHaveLength(0);
    expect(world.executor.store.batches).toHaveLength(0);
    const job = await world.data.getJob(started.jobId);
    expect(job?.status).toBe("failed");
    // The failure surface is a safe code, not a raw message.
    expect(failed.errorCode).toBeTruthy();
  });

  it("rolls back a failure AFTER graph insertion, leaving no project or page", async () => {
    const world = makeWorld();
    world.data.failAfterIngest = true;
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Post Ingest Fail" },
      files: [],
    });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("failed");
    expect(world.executor.store.projects).toHaveLength(0);
    expect(world.executor.store.batches).toHaveLength(0);
    expect(world.executor.publicProjects()).toHaveLength(0);
  });

  it("keeps a failed job retryable and the retry idempotent (one project, one batch)", async () => {
    const world = makeWorld();
    world.executor.failOnUnitCode = "A101";
    const list = JSON.stringify({
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

    world.executor.failOnUnitCode = null;
    const retried = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(retried.status).toBe("published");
    expect(world.executor.store.units).toHaveLength(1);
    expect(world.executor.store.projects).toHaveLength(1);
    expect(world.executor.store.batches).toHaveLength(1);

    // Re-entering a published job is a read, not a re-publication.
    const before = world.executor.store.batches.length;
    const again = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(again.status).toBe("published");
    expect(world.executor.store.batches).toHaveLength(before);
  });

  it("lets exactly one concurrent worker claim and publish a job", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Concurrent Project" },
      files: [],
    });
    // Two processing attempts race; the second observes a fresh claim.
    const [a, b] = await Promise.all([
      processUploadJob(world.deps, OWNER, started.jobId),
      processUploadJob(world.deps, OWNER, started.jobId),
    ]);
    const statuses = [a.status, b.status];
    expect(statuses.filter((s) => s === "published").length).toBeGreaterThanOrEqual(1);
    // Never two projects from the same job.
    expect(world.executor.store.projects).toHaveLength(1);
    expect(world.executor.store.batches).toHaveLength(1);
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
    const alphaId = world.executor.store.projects[0].id;

    await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Project Beta" },
      files: [{ name: "beta-photo.jpg" }],
    });

    const beta = world.executor.store.projects.find((row) => row.slug === "project-beta")!;
    expect(world.executor.store.units.filter((row) => row.project_id === beta.id)).toHaveLength(0);
    expect(world.executor.store.units.filter((row) => row.project_id === alphaId)).toHaveLength(
      alphaUnits,
    );
  });

  it("supports explicit unpublish and republish", async () => {
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

    const up = await setProjectPublication(world.deps, OWNER, {
      slug: "toggle-project",
      publish: true,
    });
    expect(up.publicStatus).toBe("published");
    expect(world.executor.publicProjects()).toHaveLength(1);
  });

  it("publishes with NO name, NO slug, and NO business data (deterministic identity)", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      files: [{ name: "photo.jpg" }],
    });
    uploadAll(world, started.uploads);
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("published");
    expect(result.projectSlug).toMatch(/^new-project-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/);
    expect(world.executor.publicProjects()).toHaveLength(1);
    expect(result.warnings.some((w) => w.code === "project_name_derived")).toBe(true);

    // A retry of the SAME job converges on the SAME project — no random duplicate.
    const retry = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(retry.projectSlug).toBe(result.projectSlug);
    expect(world.executor.store.projects).toHaveLength(1);
  });

  it("derives a stable identity from an uploaded project-facts file when no name is typed", async () => {
    const world = makeWorld();
    const facts = JSON.stringify({
      name: { value: "Brochure Derived Name", source_file: "facts.json", confidence: "high" },
    });
    const { result } = await runJob(
      world,
      OWNER,
      { workflow: "new_development", files: [{ name: "project-facts.json" }] },
      { "project-facts.json": facts },
    );
    expect(result.status).toBe("published");
    expect(result.projectSlug).toBe("brochure-derived-name");
  });

  it("creates the project when an update targets a slug that does not exist yet", async () => {
    const world = makeWorld();
    const { result } = await runJob(world, OWNER, {
      workflow: "project_update",
      projectSlug: "brand-new-slug",
      files: [{ name: "photo.jpg" }],
    });
    expect(result.status).toBe("published");
    expect(result.warnings.some((w) => w.code === "project_missing_created")).toBe(true);
    expect(world.executor.store.projects[0].name).toBe("Brand New Slug");
  });

  it("is fully disabled while Partner Demo mode is active", async () => {
    const world = makeWorld();
    world.flags.partnerDemo = true;
    await expect(
      startUploadJob(world.deps, OWNER, { workflow: "new_development", files: [] }),
    ).rejects.toMatchObject({ code: "studio_disabled_in_partner_demo" });
  });

  it("expands ZIP archives and routes their contents through staging", async () => {
    const world = makeWorld();
    world.archives.set("dossier.zip", [
      { name: "photos/render-1.jpg", data: tinyJpeg() },
      { name: "price-list/price-list.json", data: Buffer.from(RAINPALM_PRICE_LIST) },
    ]);
    const { result } = await runJob(
      world,
      OWNER,
      {
        workflow: "new_development",
        projectFacts: { name: "Zip Project" },
        files: [{ name: "dossier.zip" }],
      },
      { "dossier.zip": Buffer.from("PK zip placeholder") },
    );
    expect(result.status).toBe("published");
    expect(result.counts?.units).toBe(21);
    expect(world.executor.store.media.map((m) => m.media_type)).toContain("gallery");
  });

  it("retains a dangerous/unsupported archive privately WITHOUT blocking the rest", async () => {
    const world = makeWorld();
    world.archiveRejects.add("bomb.zip");
    const { result } = await runJob(
      world,
      OWNER,
      {
        workflow: "new_development",
        projectFacts: { name: "Bomb Survivor" },
        files: [{ name: "bomb.zip" }, { name: "hero.jpg" }],
      },
      { "bomb.zip": Buffer.from("PK\x03\x04 pretend bomb") },
    );
    expect(result.status).toBe("published");
    expect(result.warnings.some((w) => w.code === "archive_rejected_unsafe")).toBe(true);
    // The photo published; nothing from the rejected archive did.
    expect(world.executor.store.media).toHaveLength(1);
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(1);
  });

  it("routes uploads through server-generated staging paths only", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Bucket Project" },
      files: [
        { name: "photo.jpg" },
        { name: "Master Plan 2026.pdf" },
        { name: "Price List July.pdf" },
        { name: "dossier.zip" },
      ],
    });
    for (const upload of started.uploads) {
      expect(upload.bucket).toBe(PRIVATE_SOURCE_BUCKET);
      expect(upload.path).toMatch(
        new RegExp(`^jobs/${started.jobId}/staging/\\d{2}-[a-z0-9._-]+$`),
      );
    }
    // No object is public until finalization copies selected media.
    expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(0);
  });
});
