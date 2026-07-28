/**
 * Direct publication behaviour (Phases 1, 3, 7).
 *
 * Each test maps to a stated guarantee: no persisted draft on success, nothing
 * public on failure, idempotency by slug + fingerprint, update-not-duplicate,
 * automatic media, and independent batch items.
 */

import { describe, expect, it } from "vitest";

import type { ProgressiveBatch } from "@/features/forever-ingestion/batch-types";
import { fingerprintBatch } from "@/features/forever-ingestion/build-batch";
import { syntheticJpeg, syntheticPng } from "@/features/forever-studio/tests/media-truth-fixtures";

import { adaptBatchMode, publicMediaPath, publishProject, publishProjects } from "../publish";
import { WARNING_ENTITIES } from "../publishability";
import type { SourcePackage } from "../source-package";
import { FakeProductionWorld, OWNER_AUTHORIZATION, PRODUCTION_TARGET } from "./fakes";
import { batch, pkg } from "./publish-fixtures";

describe("publishProject", () => {
  it("publishes directly with no persisted draft and returns the public URL", async () => {
    const world = new FakeProductionWorld();
    const result = await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);

    expect(result.status).toBe("published");
    expect(result.errorCode).toBeNull();
    expect(result.publicPath).toBe("/projects/the-title-legendary");
    expect(result.publicUrl).toBe("https://forever.example/projects/the-title-legendary");

    // Nothing remains draft, and nothing else was touched.
    expect(world.projects).toHaveLength(1);
    expect(world.projects[0].publicStatus).toBe("published");
    expect(world.projects[0].isActive).toBe(true);
  });

  it("publishes despite an Internal Use Only label and unresolved canonical ids", async () => {
    const world = new FakeProductionWorld();
    const result = await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);
    expect(result.status).toBe("published");
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "source_marked_internal_use_only",
    );
    expect(result.warnings.map((warning) => warning.code)).toContain("developer_unresolved");
  });

  it("overrides the payload's own publish:false — direct mode always publishes", async () => {
    const world = new FakeProductionWorld();
    await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);
    const sent = world.directPublishCalls.at(-1)!;
    expect(sent.batch.project.publish).toBe(true);
    expect(sent.options.source_trust).toBe("owner_approved_official");
    expect(sent.options.publication_mode).toBe("direct");
    expect(sent.options.target_project_ref).toBe(PRODUCTION_TARGET.projectRef);
  });

  it("selects a hero automatically and makes it the project's main image", async () => {
    const world = new FakeProductionWorld();
    const result = await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);
    expect(result.heroPublished).toBe(true);
    expect(result.mediaPublished).toBe(3);
    const project = world.find("the-title-legendary")!;
    expect(project.mainImageUrl).toMatch(/storage\/v1\/object\/public\/project-images\/direct\//);
    expect(world.media.filter((row) => row.mediaType === "cover")).toHaveLength(1);
    expect(world.media.some((row) => row.mediaType === "master_plan")).toBe(true);
  });

  it("publishes no private path, no source filename and no sanitizer metadata", async () => {
    const world = new FakeProductionWorld();
    await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);
    const serialized = JSON.stringify(world.media);
    expect(serialized).not.toContain("owner-local");
    expect(serialized).not.toContain("pool.jpg");
    expect(serialized).not.toContain("sanitizer_version");
    expect(serialized).not.toContain("claims");
  });

  it("is idempotent: republishing the identical package adds no duplicate rows", async () => {
    const world = new FakeProductionWorld();
    const first = await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);
    const objectsAfterFirst = world.storage.size;

    const second = await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);

    expect(first.status).toBe("published");
    expect(second.status).toBe("published");
    // The second run is an update, not a create: the project already exists, so
    // the create payload is adapted to enrich and re-applied as a no-op patch.
    expect(second.mode).toBe("enrich");
    expect(world.projects).toHaveLength(1);
    expect(world.projects[0].publicStatus).toBe("published");
    expect(world.media).toHaveLength(3);
    expect(world.units).toHaveLength(1);
    expect(world.prices).toHaveLength(1);
    expect(world.buildings).toHaveLength(1);
    // Content-addressed paths: no second copy of the same bytes.
    expect(world.storage.size).toBe(objectsAfterFirst);
  });

  it("converges on a true fingerprint replay once the adapted batch is stable", async () => {
    const world = new FakeProductionWorld();
    await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION); // create
    await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION); // adapted enrich
    const third = await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);

    // The adapted enrich batch is deterministic, so its fingerprint is already
    // recorded and the third run is recognized as an exact replay.
    expect(third.replayed).toBe(true);
    expect(third.status).toBe("published");
    expect(world.projects).toHaveLength(1);
    expect(world.media).toHaveLength(3);
    expect(world.units).toHaveLength(1);
    expect(world.prices).toHaveLength(1);
  });

  it("updates the existing project instead of duplicating it when a newer source arrives", async () => {
    const world = new FakeProductionWorld();
    await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);

    // A newer official source: I501-style SOLD update plus a new price.
    const newer = pkg({
      batch: batch({
        units: [
          { unit_code: "A308", building_code: "A", availability_status: "available" },
          { unit_code: "I501", building_code: "I", availability_status: "sold" },
        ],
        prices: [
          { unit_code: "A308", price: 9500000, currency: "THB", source_file: "price-list-v4.pdf" },
        ],
      }),
    });
    const result = await publishProject(newer, world.deps(), OWNER_AUTHORIZATION);

    expect(result.status).toBe("published");
    expect(result.mode).toBe("enrich");
    expect(world.projects).toHaveLength(1);
    expect(world.units.find((unit) => unit.unitCode === "I501")?.availability).toBe("sold");
    expect(world.prices.find((price) => price.unitCode === "A308")?.price).toBe(9500000);
    expect(world.projects[0].publicStatus).toBe("published");
  });

  it("leaves nothing public when the atomic transaction fails", async () => {
    const world = new FakeProductionWorld();
    world.failDirectPublish = "forever_direct_publish: publication_not_applied";

    const result = await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("direct_publish_failed");
    expect(world.projects).toHaveLength(0);
    expect(world.media).toHaveLength(0);
  });

  it("keeps a previously published version intact when a later publish fails", async () => {
    const world = new FakeProductionWorld();
    await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);
    world.failDirectPublish = "forever_direct_publish: publication_not_applied";

    const result = await publishProject(
      pkg({ batch: batch({ units: [{ unit_code: "B101", building_code: "A" }] }) }),
      world.deps(),
      OWNER_AUTHORIZATION,
    );

    expect(result.status).toBe("failed");
    expect(world.projects).toHaveLength(1);
    expect(world.projects[0].publicStatus).toBe("published");
    expect(world.units.some((unit) => unit.unitCode === "B101")).toBe(false);
  });

  it("retains an image privately rather than failing when its upload fails", async () => {
    const world = new FakeProductionWorld();
    world.failUploadPathIncludes = "direct/the-title-legendary";

    const result = await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);

    expect(result.status).toBe("published");
    expect(result.mediaPublished).toBe(0);
    expect(result.mediaRetainedPrivate).toBe(3);
    expect(result.warnings.map((warning) => warning.code)).toContain("media_upload_failed");
  });

  it("retains a non-image official file privately instead of publishing it unverified", async () => {
    const world = new FakeProductionWorld();
    const result = await publishProject(
      pkg({
        media: [{ path: "master-plan/site-plan.pdf", bytes: Buffer.from("%PDF-1.4 master plan") }],
      }),
      world.deps(),
      OWNER_AUTHORIZATION,
    );
    expect(result.status).toBe("published");
    expect(result.mediaPublished).toBe(0);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "media_not_publishable_format",
    );
  });

  it("publishes a project with no media at all", async () => {
    const world = new FakeProductionWorld();
    const result = await publishProject(pkg({ media: [] }), world.deps(), OWNER_AUTHORIZATION);
    expect(result.status).toBe("published");
    expect(result.heroPublished).toBe(false);
    expect(world.projects[0].publicStatus).toBe("published");
  });

  it("refuses a non-Owner caller without writing anything", async () => {
    const world = new FakeProductionWorld();
    const result = await publishProject(pkg(), world.deps(), {
      ...OWNER_AUTHORIZATION,
      role: "authenticated",
    });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("direct_publish_role_required");
    expect(world.directPublishCalls).toHaveLength(0);
    expect(world.projects).toHaveLength(0);
  });

  it("refuses a package with no official source evidence", async () => {
    const world = new FakeProductionWorld();
    const result = await publishProject(
      pkg({
        batch: batch({
          project: { slug: "no-evidence", name: "No Evidence" },
          prices: [],
          buildings: [],
          units: [],
        }),
        media: [],
      }),
      world.deps(),
      OWNER_AUTHORIZATION,
    );
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("official_source_missing");
    expect(world.projects).toHaveLength(0);
  });

  it("refuses a warning the review queue cannot store, before anything is written", async () => {
    // `ingestion_warnings.entity` is a closed set enforced by a CHECK
    // constraint. Without this check the publish aborts only at the final
    // transaction — after media upload, and in a batch after earlier projects
    // have already been written.
    const world = new FakeProductionWorld();
    const result = await publishProject(
      pkg({
        batch: batch({
          // Cast: a real package is JSON read from disk, so it can carry an
          // entity the type system would have rejected at compile time.
          warnings: [
            {
              entity: "source",
              code: "official_repost_not_a_new_revision",
              severity: "info",
              message: "A repost is not a new revision.",
            },
          ] as never,
        }),
      }),
      world.deps(),
      OWNER_AUTHORIZATION,
    );
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("warning_entity_unsupported");
    expect(result.error).toContain("source");
    expect(world.directPublishCalls).toHaveLength(0);
    expect(world.projects).toHaveLength(0);
    expect(world.storage.size).toBe(0);
  });

  it("refuses an unstorable warning severity", async () => {
    const world = new FakeProductionWorld();
    const result = await publishProject(
      pkg({
        batch: batch({
          warnings: [
            { entity: "unit", code: "x", severity: "critical", message: "Too loud." },
          ] as never,
        }),
      }),
      world.deps(),
      OWNER_AUTHORIZATION,
    );
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("warning_severity_unsupported");
    expect(world.projects).toHaveLength(0);
  });

  it("accepts every entity and severity the review queue does store", async () => {
    const world = new FakeProductionWorld();
    const result = await publishProject(
      pkg({
        batch: batch({
          warnings: [...WARNING_ENTITIES].map((entity, index) => ({
            entity,
            code: `w${index}`,
            severity: index % 2 === 0 ? "info" : "warning",
            message: `Warning for ${entity}.`,
          })) as never,
        }),
      }),
      world.deps(),
      OWNER_AUTHORIZATION,
    );
    expect(result.status).toBe("published");
  });
});

describe("publishProjects", () => {
  it("processes each project independently and reports failures without losing successes", async () => {
    const world = new FakeProductionWorld();
    const good = pkg();
    const bad = pkg({
      ref: "broken",
      batch: batch({ project: { slug: "Not A Slug", name: "Broken" } }),
    });
    const alsoGood = pkg({
      ref: "second-project",
      batch: batch({ project: { ...batch().project, slug: "second-project", name: "Second" } }),
    });

    const results = await publishProjects([good, bad, alsoGood], world.deps(), OWNER_AUTHORIZATION);

    expect(results.map((result) => result.status)).toEqual(["published", "failed", "published"]);
    expect(results[1].errorCode).toBe("slug_unusable");
    expect(world.projects.map((project) => project.slug).sort()).toEqual([
      "second-project",
      "the-title-legendary",
    ]);
    for (const project of world.projects) expect(project.publicStatus).toBe("published");
    expect(
      results.filter((result) => result.status === "published").map((result) => result.publicUrl),
    ).toEqual([
      "https://forever.example/projects/the-title-legendary",
      "https://forever.example/projects/second-project",
    ]);
  });
});

describe("adaptBatchMode", () => {
  it("converts a create payload to enrich when the project already exists", () => {
    const adapted = adaptBatchMode(batch(), true);
    expect(adapted.mode).toBe("enrich");
    expect(adapted.project.set).toMatchObject({
      name: "The Title Legendary Bang-Tao",
      developer_name_raw: "Rhom Bho Property",
      construction_status: "Completed",
    });
    expect(adapted.project.publish).toBe(true);
    // Content changed, so the idempotency key must change with it.
    expect(adapted.batch_fingerprint).not.toBe(batch().batch_fingerprint);
  });

  it("converts an enrich payload to create when the project does not exist", () => {
    const source = batch({
      mode: "enrich",
      project: { slug: "fresh-project", set: { name: "Fresh Project", project_type: "Villa" } },
    });
    const adapted = adaptBatchMode(source, false);
    expect(adapted.mode).toBe("create");
    expect(adapted.project.name).toBe("Fresh Project");
    expect(adapted.project.project_type).toBe("Villa");
  });

  it("leaves an already-correct batch byte-identical", () => {
    const source = batch();
    expect(adaptBatchMode(source, false)).toBe(source);
  });
});

describe("publicMediaPath", () => {
  it("is content-addressed, so identical bytes reuse the identical object", () => {
    const digest = "a".repeat(64);
    expect(publicMediaPath("demo", digest, "jpeg")).toBe(`direct/demo/${"a".repeat(24)}.jpg`);
    expect(publicMediaPath("demo", digest, "jpeg")).toBe(publicMediaPath("demo", digest, "jpeg"));
  });

  it("refuses a path that is not derived from a real digest", () => {
    expect(() => publicMediaPath("demo", "not-a-digest", "jpeg")).toThrowError(
      /invalid_derivative_sha256/,
    );
  });
});
