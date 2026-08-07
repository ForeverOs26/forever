/**
 * FOREVER-STUDIO-UNPUBLISHED-INGESTION-001 — ingestion never publishes.
 *
 * The defect: `finalizeProject` called the atomic transaction with a hard-coded
 * `publish: true`, so `studio_publish_project` ran
 * `UPDATE projects SET public_status='published', is_active=true` on every
 * upload. Publication was therefore a SIDE EFFECT of uploading, and the only
 * thing standing between an unreviewed upload and the public site was the
 * Owner's intention.
 *
 * That override also contradicted the database's own default: the create path
 * of `forever_progressive_ingest` has always written `public_status='draft'`
 * ("saved, NEVER auto-published"). The fix is to stop overriding it.
 *
 * These tests run against `FakeIngestExecutor`, which models the migration
 * faithfully — `public_status: 'draft'` and `is_active: true` on create, the
 * enrich `project.publish` branch, and `publicProjects()` as the exact RLS
 * predicate the anonymous public reads through (`is_active AND
 * public_status='published'`). The real SQL is covered by studio.postgres.sql.
 *
 * TWO PREDICATES, KEPT APART (independent-review correction 1). The collision
 * guard keys on `public_status` ALONE. A published project that is switched off
 * (`is_active = false`) is invisible right now but is still published, and
 * absorbing an upload into it would expose the write the moment it is switched
 * back on — so it is refused identically. `publicProjects()` answers the other
 * question (visibility) and is used only where visibility is the claim.
 *
 * TWO STATUS VOCABULARIES, ALSO KEPT APART (correction 4). The database still
 * stores `status = 'published'` for a finished job; every browser-facing
 * surface reports `completed`. Both halves are asserted here.
 */

import { describe, expect, it, vi } from "vitest";

import type { ProgressiveBatch } from "@/features/forever-ingestion/batch-types";

import { StudioError } from "../server/errors";
import {
  assertUnpublishedIngestionPayload,
  getOverview,
  getProjectDetail,
  getUploadJobStatus,
  processUploadJob,
  setProjectPublication,
  startUploadJob,
} from "../server/service";
import { externalJobStatus } from "../studio-types";
import { makeWorld, uploadAll, OWNER, PUBLISHER, type FakeWorld } from "./fakes";

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

/** Record every call into the atomic transaction, and still run it for real. */
function recordPublishCalls(world: FakeWorld) {
  const calls: Array<{ publish: boolean; batch: ProgressiveBatch }> = [];
  const original = world.data.publishProject.bind(world.data);
  vi.spyOn(world.data, "publishProject").mockImplementation(async (input) => {
    calls.push({ publish: input.publish, batch: input.batch });
    return original(input);
  });
  return calls;
}

/** A structural snapshot of everything an upload could mutate. */
function graphSnapshot(world: FakeWorld) {
  return JSON.stringify({
    projects: world.executor.store.projects,
    buildings: world.executor.store.buildings,
    units: world.executor.store.units,
    prices: world.executor.store.prices,
    media: world.executor.store.media,
  });
}

// ---------------------------------------------------------------------------
// 1. A NEW project is created unpublished, and has no public route
// ---------------------------------------------------------------------------

describe("a new project processed through Studio is an unpublished draft", () => {
  it("creates it with public_status='draft' and no public visibility", async () => {
    const world = makeWorld();
    const { result } = await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Draft Only Project" },
      files: [],
    });

    // The ingestion completed: this is a success, not a blocked run.
    expect(result.status).toBe("completed");
    expect(result.errorCode).toBeNull();
    expect(world.executor.store.projects).toHaveLength(1);

    const project = world.executor.store.projects[0];
    expect(project.public_status).toBe("draft");
    expect(result.publicStatus).toBe("draft");

    // PUBLIC VISIBILITY IS INACTIVE. `publicProjects()` is the RLS predicate
    // itself (is_active AND public_status='published'), so this is the same
    // question an anonymous visitor's read asks — not a proxy for it.
    expect(world.executor.publicProjects()).toHaveLength(0);
    expect(world.executor.publicProjects().map((row) => row.slug)).not.toContain(
      "draft-only-project",
    );
  });

  it("passes publish=false into the atomic transaction, always", async () => {
    const world = makeWorld();
    const calls = recordPublishCalls(world);

    await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Constant False" },
      files: [],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].publish).toBe(false);
    // And the batch carries no publication decision of its own: on a create the
    // field map is spread to the batch top level, which is exactly where
    // `forever_progressive_ingest` reads `publish` from.
    expect(calls[0].batch.project).not.toHaveProperty("publish");
  });

  it("is still reachable and editable inside Studio while unpublished", async () => {
    // A draft that could not be reviewed would be useless. The authenticated
    // Studio surface must still resolve it — only the PUBLIC route must not.
    const world = makeWorld();
    const { result } = await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Reviewable Draft" },
      files: [],
    });

    const detail = await getProjectDetail(world.deps, OWNER, result.projectSlug!);
    expect(detail).not.toBeNull();
    expect(detail?.slug).toBe(result.projectSlug);
    // The authenticated view states the draft plainly, from the same predicate
    // the public RLS policy applies.
    expect(detail?.isPublic).toBe(false);
    expect(detail?.publicStatus).toBe("draft");
  });
});

// ---------------------------------------------------------------------------
// 2. An existing UNPUBLISHED draft updates safely and stays unpublished
// ---------------------------------------------------------------------------

describe("an existing unpublished draft can be updated and stays unpublished", () => {
  it("enriches the draft without publishing it", async () => {
    const world = makeWorld();
    const first = await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Enrichable Draft" },
      files: [],
    });
    expect(world.executor.store.projects[0].public_status).toBe("draft");

    const calls = recordPublishCalls(world);
    // The SAME name derives the SAME slug, which is how a second upload targets
    // an existing project — the repository's own "update, never duplicate" path.
    const second = await runJob(world, OWNER, {
      workflow: "project_update",
      projectFacts: { name: "Enrichable Draft", shortDescription: "Added on the second upload" },
      files: [],
    });
    expect(second.result.projectSlug).toBe(first.result.projectSlug);

    expect(second.result.status).toBe("completed");
    expect(second.result.publicStatus).toBe("draft");
    // One project, updated — never a duplicate.
    expect(world.executor.store.projects).toHaveLength(1);
    const project = world.executor.store.projects[0];
    expect(project.public_status).toBe("draft");
    expect(project.short_description).toBe("Added on the second upload");
    expect(world.executor.publicProjects()).toHaveLength(0);

    // An enrich must not carry `publish` in EITHER direction. Sending
    // `publish: false` would work here but would silently unpublish a published
    // project in the collision case, so the batch simply never carries one.
    expect(calls[0].publish).toBe(false);
    expect(calls[0].batch.project).not.toHaveProperty("publish");
  });
});

// ---------------------------------------------------------------------------
// 3. A collision with a PUBLISHED project fails closed, before any mutation
// ---------------------------------------------------------------------------

describe("an upload that collides with a published project fails closed", () => {
  const LIVE_NAME = "Live Project";
  /** The upload that collides: same name → same slug → the published project. */
  const collidingUpload = (shortDescription: string): Parameters<typeof startUploadJob>[2] => ({
    workflow: "project_update",
    projectFacts: { name: LIVE_NAME, shortDescription },
    files: [],
  });

  /** Draft → deliberately published → ready for a colliding second upload. */
  async function publishedProject(world: FakeWorld) {
    const first = await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: LIVE_NAME },
      files: [],
    });
    const slug = first.result.projectSlug!;
    await setProjectPublication(world.deps, OWNER, { slug, publish: true });
    expect(world.executor.publicProjects()).toHaveLength(1);
    return { slug, before: graphSnapshot(world) };
  }

  it("refuses the upload and reports a permanent, non-retryable failure", async () => {
    const world = makeWorld();
    await publishedProject(world);

    const { result } = await runJob(
      world,
      OWNER,
      collidingUpload("Would have overwritten the live page"),
    );

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("studio_published_project_collision");
    // Never retryable: an automatic retry would collide identically forever.
    expect(result.retryable).toBe(false);
  });

  it("does not unpublish it, does not touch its graph, and creates no duplicate", async () => {
    const world = makeWorld();
    const { slug, before } = await publishedProject(world);

    await runJob(world, OWNER, collidingUpload("Would have overwritten the live page"));

    // THE WHOLE PROJECT GRAPH IS BYTE-FOR-BYTE UNCHANGED: project row, buildings,
    // units, prices and media. Not "changed back" — never written at all.
    expect(graphSnapshot(world)).toBe(before);
    // Still published, still exactly one row for the slug.
    expect(world.executor.publicProjects().map((row) => row.slug)).toEqual([slug]);
    expect(world.executor.store.projects.filter((row) => row.slug === slug)).toHaveLength(1);
    expect(world.executor.store.projects).toHaveLength(1);
  });

  it("stops BEFORE the atomic transaction is entered at all", async () => {
    const world = makeWorld();
    await publishedProject(world);
    // Spy only now, so the setup's own transaction is not counted.
    const calls = recordPublishCalls(world);

    await runJob(world, OWNER, collidingUpload("Rejected"));

    // The refusal is not a rollback after the fact — the transaction that could
    // mutate the live project is never called.
    expect(calls).toHaveLength(0);
  });

  it("still allows the upload once the Owner deliberately unpublishes", async () => {
    // The refusal is a fail-closed default, not a dead end: the Owner's own
    // explicit action reopens the lane, and the result is again a draft.
    const world = makeWorld();
    const { slug } = await publishedProject(world);
    await setProjectPublication(world.deps, OWNER, { slug, publish: false });

    const { result } = await runJob(world, OWNER, collidingUpload("Now allowed"));

    expect(result.status).toBe("completed");
    expect(result.publicStatus).toBe("draft");
    expect(world.executor.store.projects[0].short_description).toBe("Now allowed");
    expect(world.executor.publicProjects()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // PUBLISHED BUT NOT CURRENTLY VISIBLE — the guard must still refuse.
  // -------------------------------------------------------------------------

  describe("a PUBLISHED project that is switched off (is_active=false)", () => {
    /**
     * `is_active=false` makes a published project invisible right now, and
     * nothing more. It is reachable through ordinary operations — this world
     * builds it the real way: the project is deactivated, then published, and
     * `setProjectPublication` writes `public_status` WITHOUT touching
     * `is_active` (its enrich batch carries only `publish`), so the row lands on
     * published + inactive exactly as production would.
     *
     * Guarding on VISIBILITY instead of publication state would let an upload
     * silently rewrite this project's graph, and reactivating it — a separate,
     * ordinary operation — would then expose whatever had been written. The
     * guard keys on `public_status` alone, so the hole never opens.
     */
    async function publishedButInactive(world: FakeWorld) {
      const first = await runJob(world, OWNER, {
        workflow: "new_development",
        projectFacts: { name: LIVE_NAME },
        files: [],
      });
      const slug = first.result.projectSlug!;
      // Always re-read: the executor commits by REPLACING its store with a
      // clone, so any row reference held across an ingest is stale.
      const row = () => world.executor.store.projects.find((p) => p.slug === slug)!;
      row().is_active = false;
      await setProjectPublication(world.deps, OWNER, { slug, publish: true });

      // The precondition this whole block exists for, asserted rather than
      // assumed: published, inactive, and therefore NOT publicly visible.
      expect(row().public_status).toBe("published");
      expect(row().is_active).toBe(false);
      expect(world.executor.publicProjects()).toHaveLength(0);
      return { slug, row, before: graphSnapshot(world) };
    }

    it("is refused, non-retryably, exactly like a visible published project", async () => {
      const world = makeWorld();
      await publishedButInactive(world);

      const { result } = await runJob(world, OWNER, collidingUpload("Would have been absorbed"));

      expect(result.status).toBe("failed");
      expect(result.errorCode).toBe("studio_published_project_collision");
      expect(result.retryable).toBe(false);
    });

    it("stops before batch construction and before the transaction is entered", async () => {
      const world = makeWorld();
      await publishedButInactive(world);
      const batchesBefore = world.executor.store.batches.length;
      const calls = recordPublishCalls(world);

      await runJob(world, OWNER, collidingUpload("Rejected"));

      expect(calls).toHaveLength(0);
      // Nothing was ingested either: the refused upload wrote no batch row.
      expect(world.executor.store.batches).toHaveLength(batchesBefore);
    });

    it("changes neither the project, its child graph, nor its publication or activity state", async () => {
      const world = makeWorld();
      const { slug, before } = await publishedButInactive(world);

      await runJob(world, OWNER, collidingUpload("Would have been absorbed"));

      // The whole graph, byte-for-byte.
      expect(graphSnapshot(world)).toBe(before);
      const after = world.executor.store.projects.find((p) => p.slug === slug)!;
      // Publication state unchanged — not published, and NOT auto-unpublished.
      expect(after.public_status).toBe("published");
      // Activity state unchanged — the guard does not reactivate it either.
      expect(after.is_active).toBe(false);
      expect(after.short_description).toBeNull();
      // No duplicate: still exactly one row, for this slug and in total.
      expect(world.executor.store.projects.filter((p) => p.slug === slug)).toHaveLength(1);
      expect(world.executor.store.projects).toHaveLength(1);
      // Still not publicly visible, and reactivating it would expose only what
      // was already there.
      expect(world.executor.publicProjects()).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 3b. The job-status vocabularies stay separated
// ---------------------------------------------------------------------------

describe("the persisted job status never reaches a browser-facing surface", () => {
  it("keeps the database on 'published' while every external surface says 'completed'", async () => {
    // THE ISOLATION BOUNDARY. `studio_upload_jobs.status` still stores
    // 'published' — `studio_claim_job` and `studio_publish_project` key off that
    // exact literal, so renaming it would be a migration. What must never
    // happen is that legacy word escaping to a reader as a publication claim.
    const world = makeWorld();
    const { started, result } = await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Vocabulary Split" },
      files: [],
    });

    // INTERNAL: unchanged, unmigrated.
    expect((await world.data.getJob(started.jobId))?.status).toBe("published");

    // EXTERNAL: truthful, on every surface a browser can read.
    expect(result.status).toBe("completed");
    expect((await getUploadJobStatus(world.deps, OWNER, started.jobId)).status).toBe("completed");
    const overview = await getOverview(world.deps, OWNER);
    expect(overview.jobs.map((job) => job.status)).toEqual(["completed"]);
    // And the only publication claim the result makes is the honest one.
    expect(result.publicStatus).toBe("draft");
  });

  it("maps every persisted value explicitly, and invents none", () => {
    expect(externalJobStatus("published")).toBe("completed");
    expect(externalJobStatus("received")).toBe("received");
    expect(externalJobStatus("processing")).toBe("processing");
    expect(externalJobStatus("failed")).toBe("failed");
  });

  it("reports a resale upload as completed AND publicly published", async () => {
    // The two fields answer different questions, and the resale lane is what
    // proves they are not the same field wearing two names.
    const world = makeWorld();
    const { result } = await runJob(world, OWNER, {
      workflow: "resale_listing",
      resaleFacts: { title: "Sea View 2BR", price: 12_500_000 },
      files: [],
    });

    expect(result.status).toBe("completed");
    expect(result.publicStatus).toBe("published");
    expect(result.listingId).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. No client input can enable publication during ingestion
// ---------------------------------------------------------------------------

describe("no client-supplied value can publish through ingestion", () => {
  it("ignores a `publish` field typed into the manual project facts", async () => {
    const world = makeWorld();
    const calls = recordPublishCalls(world);

    await runJob(world, OWNER, {
      workflow: "new_development",
      // Deliberately shaped like the SQL's own publication switch. The manual
      // facts mapper is an allow-list, so it can never emit a `publish` column.
      projectFacts: {
        name: "Client Publish Attempt",
        publish: true,
        public_status: "published",
        is_active: true,
      } as never,
      files: [],
    });

    expect(calls[0].publish).toBe(false);
    expect(calls[0].batch.project).not.toHaveProperty("publish");
    expect(world.executor.store.projects[0].public_status).toBe("draft");
    expect(world.executor.publicProjects()).toHaveLength(0);
  });

  it("ignores a `publish` field inside an uploaded project-facts file", async () => {
    // The other input surface: extracted facts. `projectFieldsFromFacts` is the
    // second allow-list, and it maps seven named columns and nothing else.
    const world = makeWorld();
    const calls = recordPublishCalls(world);
    const facts = JSON.stringify({
      name: { value: "Extracted Publish Attempt", source_file: "facts.json", confidence: "high" },
      publish: { value: true, source_file: "facts.json", confidence: "high" },
      public_status: { value: "published", source_file: "facts.json", confidence: "high" },
    });

    await runJob(
      world,
      OWNER,
      {
        workflow: "new_development",
        // The Full Project Archive window is the one a structured facts
        // artifact may be adopted from — see structured-purpose-boundary.
        files: [{ name: "project-facts.json", materialPurpose: "project_archive" }],
      },
      { "project-facts.json": facts },
    );

    expect(calls[0].publish).toBe(false);
    expect(calls[0].batch.project).not.toHaveProperty("publish");
    expect(world.executor.store.projects[0].public_status).toBe("draft");
    expect(world.executor.publicProjects()).toHaveLength(0);
  });

  describe("the fail-closed backstop, proved directly", () => {
    // Both allow-lists above would have to be breached for this guard to fire,
    // so it is unreachable in normal operation — which is exactly why it is
    // worth pinning: it proves the policy does not DEPEND on those allow-lists
    // staying correct. Reaching it through a mocked pipeline would test the
    // mock, so it is exercised at its own boundary instead.

    it("rejects a create payload carrying publish=true", () => {
      expect(() =>
        assertUnpublishedIngestionPayload({ slug: "x", name: "X", publish: true }),
      ).toThrowError(expect.objectContaining({ code: "studio_ingestion_publication_rejected" }));
    });

    it("rejects publish=false too — a value it must not accept in either direction", () => {
      // `publish: false` would UNPUBLISH a published project on an enrich. An
      // ingestion batch carries no publication decision at all, so the guard
      // refuses the key, not just the dangerous value.
      expect(() =>
        assertUnpublishedIngestionPayload({ slug: "x", set: {}, publish: false }),
      ).toThrowError(expect.objectContaining({ code: "studio_ingestion_publication_rejected" }));
    });

    it("marks the refusal permanent, so it is never retried", () => {
      try {
        assertUnpublishedIngestionPayload({ slug: "x", name: "X", publish: true });
        expect.unreachable("the guard must throw");
      } catch (error) {
        expect(error).toBeInstanceOf(StudioError);
        expect((error as StudioError).retryable).toBe(false);
      }
    });

    it("accepts an ordinary create and an ordinary enrich payload untouched", () => {
      expect(() =>
        assertUnpublishedIngestionPayload({ slug: "x", name: "X", field_provenance: {} }),
      ).not.toThrow();
      expect(() =>
        assertUnpublishedIngestionPayload({ slug: "x", set: { short_description: "y" } }),
      ).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// 5. The separate publication action stays protected AND functional
// ---------------------------------------------------------------------------

describe("publication remains possible only through the separate action", () => {
  it("publishes when the Owner asks, and only then", async () => {
    const world = makeWorld();
    const { result } = await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Deliberate Publication" },
      files: [],
    });
    const slug = result.projectSlug!;
    expect(world.executor.publicProjects()).toHaveLength(0);

    const published = await setProjectPublication(world.deps, OWNER, { slug, publish: true });

    expect(published.publicStatus).toBe("published");
    expect(world.executor.publicProjects().map((row) => row.slug)).toEqual([slug]);
    // And it is audited as a publication — the one action that may claim it.
    expect(world.data.audits.some((row) => row.action === "studio_project_published")).toBe(true);
  });

  it("still refuses a publisher who does not own the project", async () => {
    // The authorization contract is untouched by this change.
    const world = makeWorld();
    const { result } = await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Owner Only Draft" },
      files: [],
    });

    await expect(
      setProjectPublication(world.deps, PUBLISHER, {
        slug: result.projectSlug!,
        publish: true,
      }),
    ).rejects.toMatchObject({ code: "studio_access_denied" });
    expect(world.executor.publicProjects()).toHaveLength(0);
  });

  it("refuses an unknown project rather than creating one", async () => {
    const world = makeWorld();
    await expect(
      setProjectPublication(world.deps, OWNER, { slug: "no-such-project", publish: true }),
    ).rejects.toMatchObject({ code: "project_not_found" });
    expect(world.executor.store.projects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. The audit trail never attributes a publication to an upload
// ---------------------------------------------------------------------------

describe("the audit trail describes what actually happened", () => {
  it("records a draft create, and no publication, for a new-project upload", async () => {
    const world = makeWorld();
    await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Audited Draft" },
      files: [],
    });

    const actions = world.data.audits.map((row) => row.action);
    expect(actions).toContain("studio_project_created_draft");
    expect(actions).not.toContain("studio_project_created_published");
    expect(actions.filter((action) => action.endsWith("_published"))).toHaveLength(0);
  });

  it("records a draft update, and no publication, for a second upload", async () => {
    const world = makeWorld();
    await runJob(world, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Audited Update" },
      files: [],
    });
    await runJob(world, OWNER, {
      workflow: "project_update",
      projectFacts: { name: "Audited Update", shortDescription: "Second pass" },
      files: [],
    });

    const actions = world.data.audits.map((row) => row.action);
    expect(actions).toContain("studio_project_updated_draft");
    expect(actions.filter((action) => action.endsWith("_published"))).toHaveLength(0);
  });
});
