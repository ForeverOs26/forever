/**
 * Cross-publisher object authorization.  These call the server service
 * directly, which is the same boundary reached by a guessed Studio editor
 * URL: routes contain no private loader data and invoke these guarded server
 * functions only after authentication middleware has resolved the actor.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { StudioActor } from "../server/contracts";
import {
  getListingDetail,
  getOverview,
  getProjectDetail,
  processUploadJob,
  resumeDueJobs,
  saveProjectFacts,
  setListingPublication,
  setProjectHeroImage,
  setProjectPublication,
  startUploadJob,
  updateResaleListing,
} from "../server/service";
import { makeWorld, OWNER, PUBLISHER } from "./fakes";

const PUBLISHER_B: StudioActor = {
  userId: "user-publisher-b",
  email: "publisher-b@example.com",
  role: "trusted_publisher",
  displayName: "Publisher B",
};

const OWNERSHIP_BACKFILL_MIGRATION =
  "supabase/migrations/20260722110000_studio_object_ownership_backfill.sql";

async function createProject(
  world: ReturnType<typeof makeWorld>,
  actor: StudioActor,
  slug: string,
) {
  const started = await startUploadJob(world.deps, actor, {
    workflow: "new_development",
    projectSlug: slug,
    projectFacts: { name: `${slug} private title` },
    files: [],
  });
  const result = await processUploadJob(world.deps, actor, started.jobId);
  return { started, result };
}

async function createListing(world: ReturnType<typeof makeWorld>, actor: StudioActor) {
  const started = await startUploadJob(world.deps, actor, {
    workflow: "resale_listing",
    resaleFacts: {
      title: "B secret listing",
      price: 9_900_000,
      contactName: "Private seller",
      contactEmail: "private-seller@example.com",
    },
    files: [],
  });
  const result = await processUploadJob(world.deps, actor, started.jobId);
  return { started, listingId: result.listingId! };
}

function state(world: ReturnType<typeof makeWorld>) {
  return JSON.stringify({
    projects: world.executor.store.projects,
    media: world.executor.store.media,
    listings: world.data.listings,
    contacts: [...world.data.contacts],
    objectOwners: [...world.data.objectOwners],
    jobs: [...world.data.jobs],
    objects: [...world.storage.objects],
    audits: world.data.audits,
  });
}

describe("Studio object authorization", () => {
  it("persists ownership in an internal RLS table, never public object rows", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260722103000_studio_object_authorization.sql"),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.studio_object_owners");
    expect(sql).toContain("ALTER TABLE public.studio_object_owners ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.studio_object_owners FROM PUBLIC, anon, authenticated",
    );
    expect(sql).not.toContain("ADD COLUMN IF NOT EXISTS studio_created_by");
  });

  it("uses a separate deterministic corrective migration for existing objects", () => {
    const sql = readFileSync(resolve(process.cwd(), OWNERSHIP_BACKFILL_MIGRATION), "utf8");
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.studio_backfill_existing_object_owners()",
    );
    expect(sql).toContain("status = 'published' AND workflow = 'new_development'");
    expect(sql).toContain("status = 'published' AND workflow = 'resale_listing'");
    expect(sql).toContain("studio_owner_backfill_creator_conflict");
    expect(sql).toContain("studio_owner_backfill_multiple_owners");
    expect(sql).toContain("studio_owner_backfill_existing_owner_conflict");
    expect(sql).toContain("ORDER BY object_type, object_id, job_created_at ASC, job_id ASC");
    expect(sql).toContain("LOCK TABLE public.projects, public.listings, public.studio_upload_jobs");
    expect(sql).toContain("SELECT public.studio_backfill_existing_object_owners()");
    expect(sql).not.toMatch(/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });

  it("denies guessed project and resale editor reads without leaking private fields", async () => {
    const world = makeWorld();
    const project = await createProject(world, PUBLISHER_B, "publisher-b-project");
    const listing = await createListing(world, PUBLISHER_B);

    await expect(
      getProjectDetail(world.deps, PUBLISHER, project.result.projectSlug!),
    ).rejects.toMatchObject({
      code: "studio_access_denied",
    });
    await expect(getListingDetail(world.deps, PUBLISHER, listing.listingId)).rejects.toMatchObject({
      code: "studio_access_denied",
    });

    // The returned denial is stable and contains neither title, contact nor
    // listing/project identifiers; this models a direct server-function call
    // from a guessed /studio/project/:slug or /studio/resale/:id URL.
    const projectError = await getProjectDetail(
      world.deps,
      PUBLISHER,
      project.result.projectSlug!,
    ).catch((error) => error);
    const listingError = await getListingDetail(world.deps, PUBLISHER, listing.listingId).catch(
      (error) => error,
    );
    const denial = JSON.stringify([projectError, listingError]);
    expect(denial).toContain("studio_access_denied");
    for (const secret of [
      "publisher-b-project private title",
      "B secret listing",
      "Private seller",
      "private-seller@example.com",
      listing.listingId,
    ]) {
      expect(denial).not.toContain(secret);
    }
  });

  it("denies cross-publisher upload, direct mutations, retry, and resume with zero state change", async () => {
    const world = makeWorld();
    const project = await createProject(world, PUBLISHER_B, "publisher-b-project");
    const listing = await createListing(world, PUBLISHER_B);
    const bJob = await startUploadJob(world.deps, PUBLISHER_B, {
      workflow: "project_update",
      projectSlug: project.result.projectSlug!,
      projectFacts: { name: "B update never run by A" },
      files: [],
    });
    const before = state(world);

    await expect(
      startUploadJob(world.deps, PUBLISHER, {
        workflow: "construction_media_update",
        projectSlug: project.result.projectSlug!,
        files: [{ name: "guessed-target.jpg" }],
      }),
    ).rejects.toMatchObject({ code: "studio_access_denied" });
    await expect(
      saveProjectFacts(world.deps, PUBLISHER, {
        slug: project.result.projectSlug!,
        facts: { name: "A overwrite" },
      }),
    ).rejects.toMatchObject({ code: "studio_access_denied" });
    await expect(
      setProjectHeroImage(world.deps, PUBLISHER, { slug: project.result.projectSlug!, url: "" }),
    ).rejects.toMatchObject({ code: "studio_access_denied" });
    await expect(
      setProjectPublication(world.deps, PUBLISHER, {
        slug: project.result.projectSlug!,
        publish: false,
      }),
    ).rejects.toMatchObject({ code: "studio_access_denied" });
    await expect(
      setProjectPublication(world.deps, PUBLISHER, {
        slug: project.result.projectSlug!,
        publish: true,
      }),
    ).rejects.toMatchObject({ code: "studio_access_denied" });
    await expect(
      setListingPublication(world.deps, PUBLISHER, {
        listingId: listing.listingId,
        publish: false,
      }),
    ).rejects.toMatchObject({ code: "studio_access_denied" });
    await expect(
      setListingPublication(world.deps, PUBLISHER, { listingId: listing.listingId, publish: true }),
    ).rejects.toMatchObject({ code: "studio_access_denied" });
    await expect(
      updateResaleListing(world.deps, PUBLISHER, {
        listingId: listing.listingId,
        facts: { contactEmail: "attacker@example.com" },
      }),
    ).rejects.toMatchObject({ code: "studio_access_denied" });
    await expect(processUploadJob(world.deps, PUBLISHER, bJob.jobId)).rejects.toMatchObject({
      code: "studio_access_denied",
    });
    expect(await resumeDueJobs(world.deps, PUBLISHER)).toEqual({ resumed: 0, results: [] });
    expect(state(world)).toBe(before);
  });

  it("keeps Publisher ownership intact while the Owner may manage either publisher's objects and jobs", async () => {
    const world = makeWorld();
    const ownProject = await createProject(world, PUBLISHER, "publisher-a-project");
    const bProject = await createProject(world, PUBLISHER_B, "publisher-b-project");
    const ownListing = await createListing(world, PUBLISHER);
    const bListing = await createListing(world, PUBLISHER_B);

    await expect(
      getProjectDetail(world.deps, PUBLISHER, ownProject.result.projectSlug!),
    ).resolves.toMatchObject({
      slug: "publisher-a-project",
    });
    await expect(
      getListingDetail(world.deps, PUBLISHER, ownListing.listingId),
    ).resolves.toMatchObject({
      id: ownListing.listingId,
    });
    await saveProjectFacts(world.deps, PUBLISHER, {
      slug: ownProject.result.projectSlug!,
      facts: { shortDescription: "Publisher A own edit" },
    });
    await setProjectPublication(world.deps, PUBLISHER, {
      slug: ownProject.result.projectSlug!,
      publish: false,
    });
    await setListingPublication(world.deps, PUBLISHER, {
      listingId: ownListing.listingId,
      publish: false,
    });

    // Owner can read and mutate both publishers' objects, including the
    // otherwise cross-publisher publication and editor actions.
    await expect(
      getProjectDetail(world.deps, OWNER, bProject.result.projectSlug!),
    ).resolves.toMatchObject({
      slug: "publisher-b-project",
    });
    await expect(getListingDetail(world.deps, OWNER, bListing.listingId)).resolves.toMatchObject({
      id: bListing.listingId,
    });
    await saveProjectFacts(world.deps, OWNER, {
      slug: bProject.result.projectSlug!,
      facts: { shortDescription: "Owner edit" },
    });
    await setProjectHeroImage(world.deps, OWNER, { slug: bProject.result.projectSlug!, url: "" });
    await setProjectPublication(world.deps, OWNER, {
      slug: bProject.result.projectSlug!,
      publish: false,
    });
    await setProjectPublication(world.deps, OWNER, {
      slug: bProject.result.projectSlug!,
      publish: true,
    });
    await updateResaleListing(world.deps, OWNER, {
      listingId: bListing.listingId,
      facts: { description: "Owner managed B listing" },
    });
    await setListingPublication(world.deps, OWNER, {
      listingId: bListing.listingId,
      publish: false,
    });
    await setListingPublication(world.deps, OWNER, {
      listingId: bListing.listingId,
      publish: true,
    });

    const overview = await getOverview(world.deps, PUBLISHER);
    expect(overview.projects.map((item) => item.slug)).toEqual(["publisher-a-project"]);
    expect(overview.listings.map((item) => item.id)).toEqual([ownListing.listingId]);
    expect(
      world.data.listings.find((item) => item.id === bListing.listingId)?.publication_status,
    ).toBe("published");
  });

  it("continues to deny non-members and disabled publishers before server functions run", async () => {
    const world = makeWorld();
    const { resolveStudioActor } = await import("../server/membership");
    await expect(
      resolveStudioActor(world.deps, { userId: "non-member", email: "no@example.com" }),
    ).rejects.toMatchObject({ code: "studio_membership_required" });
    await world.data.upsertMembership({
      user_id: "disabled-publisher",
      role: "trusted_publisher",
      display_name: null,
      email: "disabled@example.com",
      invited_by: OWNER.userId,
      is_active: false,
    });
    await expect(
      resolveStudioActor(world.deps, {
        userId: "disabled-publisher",
        email: "disabled@example.com",
      }),
    ).rejects.toMatchObject({ code: "studio_membership_disabled" });
  });
});
