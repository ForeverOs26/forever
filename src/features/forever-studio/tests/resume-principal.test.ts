/**
 * FOREVER-STUDIO-001 — source, authorization, and execution principal separation.
 */

import { describe, expect, it } from "vitest";

import {
  resumeDueJobs,
  saveProjectFacts,
  setProjectPublication,
  startUploadJob,
  updateResaleListing,
} from "../server/service";
import { makeWorld, OWNER, PUBLISHER } from "./fakes";

async function makeStale(
  world: ReturnType<typeof makeWorld>,
  jobId: string,
  token: string,
): Promise<void> {
  await world.data.requestJobProcessing(jobId, token, 900);
  world.advanceMinutes(20);
}

describe("resume principal separation", () => {
  it("keeps Publisher project facts and ownership Publisher-sourced when an Owner resumes", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, PUBLISHER, {
      workflow: "new_development",
      projectFacts: { name: "Publisher Resume Project", shortDescription: "Publisher supplied" },
      files: [],
    });
    await makeStale(world, started.jobId, "dead-publisher-project-worker");

    const resumed = await resumeDueJobs(world.deps, OWNER);
    const project = world.executor.store.projects[0];
    const provenance = project.field_provenance as Record<string, { status?: string }>;
    const audit = world.data.audits.find(
      (entry) => entry.action === "studio_project_created_published",
    );

    expect.soft(resumed.resumed).toBe(1);
    expect.soft(provenance.name?.status).toBe("trusted_publisher_provided");
    expect.soft(provenance.short_description?.status).toBe("trusted_publisher_provided");
    expect
      .soft(world.data.objectOwners.get(`project:${String(project.id)}`))
      .toBe(PUBLISHER.userId);
    expect.soft(audit?.actor_id).toBe(OWNER.userId);
    expect.soft(audit?.metadata).toMatchObject({
      source_creator_id: PUBLISHER.userId,
      source_creator_email: PUBLISHER.email,
      source_creator_role: PUBLISHER.role,
      executed_by_id: OWNER.userId,
      executed_by_role: OWNER.role,
      resumed_by_owner: true,
    });

    await saveProjectFacts(world.deps, PUBLISHER, {
      slug: project.slug,
      facts: { shortDescription: "Publisher corrected after Owner resume" },
    });
    expect(world.executor.store.projects[0].short_description).toBe(
      "Publisher corrected after Owner resume",
    );
    await setProjectPublication(world.deps, OWNER, { slug: project.slug, publish: false });
    await setProjectPublication(world.deps, OWNER, { slug: project.slug, publish: true });
    expect(world.executor.store.projects[0].public_status).toBe("published");
  });

  it("keeps Publisher resale facts and ownership Publisher-sourced when an Owner resumes", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, PUBLISHER, {
      workflow: "resale_listing",
      resaleFacts: {
        title: "Publisher Resume Resale",
        price: 7_500_000,
        contactEmail: "private.publisher@example.com",
      },
      files: [],
    });
    await makeStale(world, started.jobId, "dead-publisher-resale-worker");

    const resumed = await resumeDueJobs(world.deps, OWNER);
    const listing = world.data.listings[0];
    const provenance = listing.field_provenance as Record<string, { status?: string }>;
    const audit = world.data.audits.find((entry) => entry.action === "studio_resale_published");

    expect.soft(resumed.resumed).toBe(1);
    expect.soft(provenance.title?.status).toBe("trusted_publisher_provided");
    expect.soft(provenance.price?.status).toBe("trusted_publisher_provided");
    expect.soft(world.data.objectOwners.get(`listing:${listing.id}`)).toBe(PUBLISHER.userId);
    expect.soft(listing).not.toHaveProperty("contact_email");
    expect
      .soft(world.data.contacts.get(listing.id)?.contact_email)
      .toBe("private.publisher@example.com");
    expect.soft(audit?.actor_id).toBe(OWNER.userId);
    expect.soft(audit?.metadata).toMatchObject({
      source_creator_id: PUBLISHER.userId,
      source_creator_email: PUBLISHER.email,
      source_creator_role: PUBLISHER.role,
      executed_by_id: OWNER.userId,
      executed_by_role: OWNER.role,
      resumed_by_owner: true,
    });

    await updateResaleListing(world.deps, PUBLISHER, {
      listingId: listing.id,
      facts: { price: 7_250_000 },
    });
    expect(world.data.listings[0].price).toBe(7_250_000);
    expect(world.data.contacts.get(listing.id)?.contact_email).toBe(
      "private.publisher@example.com",
    );
  });

  it("keeps Owner-created facts owner_provided when the Owner resumes", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Owner Resume Project", shortDescription: "Owner supplied" },
      files: [],
    });
    await makeStale(world, started.jobId, "dead-owner-project-worker");

    expect((await resumeDueJobs(world.deps, OWNER)).resumed).toBe(1);
    const project = world.executor.store.projects[0];
    const provenance = project.field_provenance as Record<string, { status?: string }>;
    const audit = world.data.audits.find(
      (entry) => entry.action === "studio_project_created_published",
    );

    expect(provenance.name?.status).toBe("owner_provided");
    expect(provenance.short_description?.status).toBe("owner_provided");
    expect(world.data.objectOwners.get(`project:${String(project.id)}`)).toBe(OWNER.userId);
    expect(audit?.metadata).toMatchObject({
      source_creator_id: OWNER.userId,
      source_creator_role: OWNER.role,
      authorization_principal_id: OWNER.userId,
      authorization_principal_role: OWNER.role,
      executed_by_id: OWNER.userId,
      executed_by_role: OWNER.role,
      resumed_by_owner: false,
    });
  });

  it("uses the submission role for provenance and the current active role for authorization", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, PUBLISHER, {
      workflow: "new_development",
      projectFacts: { name: "Role Transition Project", shortDescription: "Submitted as Publisher" },
      files: [],
    });
    const membership = world.data.members.find((row) => row.user_id === PUBLISHER.userId)!;
    membership.role = "owner";
    await makeStale(world, started.jobId, "dead-role-transition-worker");

    expect((await resumeDueJobs(world.deps, OWNER)).resumed).toBe(1);
    const project = world.executor.store.projects[0];
    const provenance = project.field_provenance as Record<string, { status?: string }>;
    const audit = world.data.audits.find(
      (entry) => entry.action === "studio_project_created_published",
    );

    expect(provenance.name?.status).toBe("trusted_publisher_provided");
    expect(provenance.short_description?.status).toBe("trusted_publisher_provided");
    expect(world.data.objectOwners.get(`project:${String(project.id)}`)).toBe(PUBLISHER.userId);
    expect(audit?.metadata).toMatchObject({
      source_creator_role: "trusted_publisher",
      authorization_principal_id: PUBLISHER.userId,
      authorization_principal_role: "owner",
    });
  });

  it("does not mutate database or storage when a disabled Publisher job is resumed by Owner", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, PUBLISHER, {
      workflow: "new_development",
      projectFacts: { name: "Disabled Publisher Project" },
      files: [{ name: "private-source.jpg" }],
    });
    const target = started.uploads[0];
    world.storage.put(target.bucket, target.path, Buffer.from("private-only"));
    await makeStale(world, started.jobId, "dead-disabled-publisher-worker");
    const membership = world.data.members.find((row) => row.user_id === PUBLISHER.userId)!;
    membership.is_active = false;

    const before = JSON.stringify({
      jobs: [...world.data.jobs],
      store: world.executor.store,
      listings: world.data.listings,
      contacts: [...world.data.contacts],
      warnings: world.data.listingWarnings,
      owners: [...world.data.objectOwners],
      audits: world.data.audits,
      objects: [...world.storage.objects].map(([key, value]) => [key, value.toString("hex")]),
      contentTypes: [...world.storage.contentTypes],
      tokenSeq: world.flags.tokenSeq,
    });

    await expect(resumeDueJobs(world.deps, OWNER)).rejects.toMatchObject({
      code: "studio_membership_required",
    });
    expect(
      JSON.stringify({
        jobs: [...world.data.jobs],
        store: world.executor.store,
        listings: world.data.listings,
        contacts: [...world.data.contacts],
        warnings: world.data.listingWarnings,
        owners: [...world.data.objectOwners],
        audits: world.data.audits,
        objects: [...world.storage.objects].map(([key, value]) => [key, value.toString("hex")]),
        contentTypes: [...world.storage.contentTypes],
        tokenSeq: world.flags.tokenSeq,
      }),
    ).toBe(before);
  });
});
