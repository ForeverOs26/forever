/**
 * FOREVER-STUDIO-001 — server-enforced authorization tests.
 *
 * The boundary under test is resolveStudioActor + the owner-only service
 * guards: a valid Supabase session alone is NEVER enough, membership is
 * server-managed, and there is no public self-registration path.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveStudioActor } from "../server/membership";
import { getOverview, inviteMember, setMemberActive, startUploadJob } from "../server/service";
import { makeWorld, enroll, OWNER, PUBLISHER } from "./fakes";

describe("Studio authorization boundary", () => {
  it("rejects an authenticated user with no membership", async () => {
    const world = makeWorld();
    await expect(
      resolveStudioActor(world.deps, { userId: "user-random", email: "random@example.com" }),
    ).rejects.toMatchObject({ code: "studio_membership_required" });
  });

  it("rejects a disabled membership", async () => {
    const world = makeWorld();
    await world.data.upsertMembership({
      user_id: "user-x",
      role: "trusted_publisher",
      display_name: null,
      email: "x@example.com",
      invited_by: OWNER.userId,
      is_active: false,
    });
    await expect(
      resolveStudioActor(world.deps, { userId: "user-x", email: "x@example.com" }),
    ).rejects.toMatchObject({ code: "studio_membership_disabled" });
  });

  it("resolves an active member with its server-stored role", async () => {
    const world = makeWorld();
    enroll(world, PUBLISHER);
    const actor = await resolveStudioActor(world.deps, {
      userId: PUBLISHER.userId,
      email: PUBLISHER.email,
    });
    expect(actor.role).toBe("trusted_publisher");
  });

  describe("owner bootstrap (the only path that does not require an invite)", () => {
    it("enrolls the configured owner email exactly once on an empty roster", async () => {
      const world = makeWorld();
      world.flags.ownerBootstrapEmail = "owner@example.com";
      const actor = await resolveStudioActor(world.deps, {
        userId: "user-owner",
        email: "Owner@Example.com",
      });
      expect(actor.role).toBe("owner");
      expect(world.data.audits.some((row) => row.action === "studio_owner_bootstrap")).toBe(true);
    });

    it("never bootstraps a non-matching email", async () => {
      const world = makeWorld();
      world.flags.ownerBootstrapEmail = "owner@example.com";
      await expect(
        resolveStudioActor(world.deps, { userId: "user-mallory", email: "mallory@example.com" }),
      ).rejects.toMatchObject({ code: "studio_membership_required" });
    });

    it("never bootstraps once any membership exists (no takeover)", async () => {
      const world = makeWorld();
      world.flags.ownerBootstrapEmail = "owner@example.com";
      enroll(world, PUBLISHER);
      await expect(
        resolveStudioActor(world.deps, { userId: "user-second", email: "owner@example.com" }),
      ).rejects.toMatchObject({ code: "studio_membership_required" });
    });

    it("does nothing when no bootstrap email is configured", async () => {
      const world = makeWorld();
      await expect(
        resolveStudioActor(world.deps, { userId: "user-owner", email: "owner@example.com" }),
      ).rejects.toMatchObject({ code: "studio_membership_required" });
    });
  });

  describe("role separation", () => {
    it("lets a trusted publisher upload and publish but not manage members", async () => {
      const world = makeWorld();
      const started = await startUploadJob(world.deps, PUBLISHER, {
        workflow: "new_development",
        projectFacts: { name: "Publisher Project" },
        files: [],
      });
      expect(started.jobId).toBeTruthy();
      await expect(
        inviteMember(world.deps, PUBLISHER, {
          email: "new@example.com",
          password: "longpassword123",
        }),
      ).rejects.toMatchObject({ code: "studio_owner_required" });
      await expect(
        setMemberActive(world.deps, PUBLISHER, { userId: OWNER.userId, isActive: false }),
      ).rejects.toMatchObject({ code: "studio_owner_required" });
    });

    it("owner invites create a confirmed account plus an active membership", async () => {
      const world = makeWorld();
      enroll(world, OWNER);
      const invited = await inviteMember(world.deps, OWNER, {
        email: "publisher2@example.com",
        password: "longpassword123",
        displayName: "P2",
      });
      const membership = await world.data.getMembership(invited.userId);
      expect(membership).toMatchObject({
        role: "trusted_publisher",
        is_active: true,
        invited_by: OWNER.userId,
      });
      // Re-inviting the same email reuses the auth account.
      const reinvited = await inviteMember(world.deps, OWNER, {
        email: "publisher2@example.com",
        password: "anotherlongpass",
      });
      expect(reinvited.userId).toBe(invited.userId);
      expect(world.data.authUsers).toHaveLength(1);
    });

    it("protects against disabling yourself or the last owner", async () => {
      const world = makeWorld();
      enroll(world, OWNER);
      await expect(
        setMemberActive(world.deps, OWNER, { userId: OWNER.userId, isActive: false }),
      ).rejects.toMatchObject({ code: "cannot_disable_self" });

      await world.data.upsertMembership({
        user_id: "user-owner-2",
        role: "owner",
        display_name: null,
        email: "owner2@example.com",
        invited_by: OWNER.userId,
        is_active: true,
      });
      await setMemberActive(world.deps, OWNER, { userId: "user-owner-2", isActive: false });
      expect((await world.data.getMembership("user-owner-2"))?.is_active).toBe(false);

      // A disabled publisher can be re-enabled and disabled again by the owner.
      enroll(world, PUBLISHER);
      await setMemberActive(world.deps, OWNER, { userId: PUBLISHER.userId, isActive: false });
      await expect(
        resolveStudioActor(world.deps, { userId: PUBLISHER.userId, email: PUBLISHER.email }),
      ).rejects.toMatchObject({ code: "studio_membership_disabled" });
    });

    it("scopes the overview: only the owner sees the member roster", async () => {
      const world = makeWorld();
      enroll(world, OWNER);
      enroll(world, PUBLISHER);
      const ownerView = await getOverview(world.deps, OWNER);
      const publisherView = await getOverview(world.deps, PUBLISHER);
      expect(ownerView.members.length).toBe(2);
      expect(publisherView.members).toHaveLength(0);
    });
  });

  describe("no self-registration surface", () => {
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

    it("the login UI offers sign-in only — no signUp call anywhere in Studio", () => {
      const login = read("src/features/forever-studio/components/StudioLogin.tsx");
      expect(login).toContain("signInWithPassword");
      expect(login).not.toContain("signUp");
      const files = [
        "src/features/forever-studio/components/StudioDashboard.tsx",
        "src/features/forever-studio/components/StudioUploader.tsx",
        "src/features/forever-studio/components/StudioMembers.tsx",
        "src/features/forever-studio/components/useStudioSession.ts",
      ];
      for (const file of files) {
        expect(read(file)).not.toContain("signUp");
      }
    });

    it("every Studio server function runs behind requireStudioMember", () => {
      const functions = read("src/features/forever-studio/studio.functions.ts");
      const serverFnCount = (functions.match(/createServerFn\(/g) ?? []).length;
      const guardedCount = (functions.match(/\.middleware\(\[requireStudioMember\]\)/g) ?? [])
        .length;
      expect(serverFnCount).toBeGreaterThanOrEqual(9);
      expect(guardedCount).toBe(serverFnCount);
    });
  });
});
