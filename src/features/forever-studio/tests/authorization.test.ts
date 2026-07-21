/**
 * FOREVER-STUDIO-001 — server-enforced authorization tests (hardened).
 *
 * A valid Supabase session alone is NEVER enough; membership is server-managed
 * with a single-winner bootstrap; there is no public self-registration; and
 * invitations never display or persist a password.
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

  describe("owner bootstrap", () => {
    it("enrolls the configured owner email once, only when confirmed and roster empty", async () => {
      const world = makeWorld();
      world.flags.ownerBootstrapEmail = "owner@example.com";
      const actor = await resolveStudioActor(world.deps, {
        userId: "user-owner",
        email: "Owner@Example.com",
        emailVerified: true,
      });
      expect(actor.role).toBe("owner");
      expect(world.data.audits.some((row) => row.action === "studio_owner_bootstrap")).toBe(true);
    });

    it("refuses email bootstrap when the email is unconfirmed", async () => {
      const world = makeWorld();
      world.flags.ownerBootstrapEmail = "owner@example.com";
      await expect(
        resolveStudioActor(world.deps, {
          userId: "user-owner",
          email: "owner@example.com",
          emailVerified: false,
        }),
      ).rejects.toMatchObject({ code: "studio_membership_required" });
    });

    it("prefers a stable owner user id when configured", async () => {
      const world = makeWorld();
      world.flags.ownerBootstrapUserId = "user-owner";
      const actor = await resolveStudioActor(world.deps, {
        userId: "user-owner",
        email: null,
        emailVerified: false,
      });
      expect(actor.role).toBe("owner");
    });

    it("never bootstraps a non-matching identity", async () => {
      const world = makeWorld();
      world.flags.ownerBootstrapEmail = "owner@example.com";
      await expect(
        resolveStudioActor(world.deps, {
          userId: "user-mallory",
          email: "mallory@example.com",
          emailVerified: true,
        }),
      ).rejects.toMatchObject({ code: "studio_membership_required" });
    });

    it("never bootstraps once any membership exists (single-winner)", async () => {
      const world = makeWorld();
      world.flags.ownerBootstrapEmail = "owner@example.com";
      enroll(world, PUBLISHER);
      await expect(
        resolveStudioActor(world.deps, {
          userId: "user-second",
          email: "owner@example.com",
          emailVerified: true,
        }),
      ).rejects.toMatchObject({ code: "studio_membership_required" });
    });

    it("two racing bootstraps mint exactly one owner", async () => {
      const world = makeWorld();
      world.flags.ownerBootstrapEmail = "owner@example.com";
      const results = await Promise.allSettled([
        resolveStudioActor(world.deps, {
          userId: "u1",
          email: "owner@example.com",
          emailVerified: true,
        }),
        resolveStudioActor(world.deps, {
          userId: "u2",
          email: "owner@example.com",
          emailVerified: true,
        }),
      ]);
      const owners = (await world.data.listMembers()).filter((m) => m.role === "owner");
      expect(owners).toHaveLength(1);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
  });

  describe("role separation and invitations", () => {
    it("lets a trusted publisher upload but not manage members", async () => {
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

    it("owner invites create a confirmed account and never echo a password", async () => {
      const world = makeWorld();
      enroll(world, OWNER);
      const invited = await inviteMember(world.deps, OWNER, {
        email: "publisher2@example.com",
        password: "longpassword123",
        displayName: "P2",
      });
      expect(invited.created).toBe(true);
      const membership = await world.data.getMembership(invited.userId);
      expect(membership).toMatchObject({
        role: "trusted_publisher",
        is_active: true,
        invited_by: OWNER.userId,
      });
      // No audit metadata carries password material.
      const audit = world.data.audits.find((a) => a.action === "studio_member_invited");
      expect(JSON.stringify(audit)).not.toContain("longpassword123");
    });

    it("invites an EXISTING auth account with no password (not already a member)", async () => {
      const world = makeWorld();
      enroll(world, OWNER);
      world.data.authUsers.push({ id: "existing-uid", email: "existing@example.com" });
      const invited = await inviteMember(world.deps, OWNER, { email: "existing@example.com" });
      expect(invited).toEqual({ userId: "existing-uid", created: false });
      expect(world.data.authUsers).toHaveLength(1);
    });

    it("requires a password only when the account does not yet exist", async () => {
      const world = makeWorld();
      enroll(world, OWNER);
      await expect(
        inviteMember(world.deps, OWNER, { email: "brand-new@example.com" }),
      ).rejects.toMatchObject({ code: "invite_password_required" });
    });

    it("protects against disabling yourself or the last owner", async () => {
      const world = makeWorld();
      enroll(world, OWNER);
      await expect(
        setMemberActive(world.deps, OWNER, { userId: OWNER.userId, isActive: false }),
      ).rejects.toMatchObject({ code: "cannot_disable_self" });

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

    it("the login UI offers sign-in only — no signUp anywhere in Studio", () => {
      const login = read("src/features/forever-studio/components/StudioLogin.tsx");
      expect(login).toContain("signInWithPassword");
      expect(login).not.toContain("signUp");
      for (const file of [
        "src/features/forever-studio/components/StudioDashboard.tsx",
        "src/features/forever-studio/components/StudioUploader.tsx",
        "src/features/forever-studio/components/StudioMembers.tsx",
        "src/features/forever-studio/components/useStudioSession.ts",
      ]) {
        expect(read(file)).not.toContain("signUp");
      }
    });

    it("every Studio server function runs behind requireStudioMember", () => {
      const functions = read("src/features/forever-studio/studio.functions.ts");
      const serverFnCount = (functions.match(/createServerFn\(/g) ?? []).length;
      const guardedCount = (functions.match(/\.middleware\(\[requireStudioMember\]\)/g) ?? [])
        .length;
      expect(serverFnCount).toBeGreaterThanOrEqual(12);
      expect(guardedCount).toBe(serverFnCount);
    });

    it("the members UI never renders the password as text", () => {
      const members = read("src/features/forever-studio/components/StudioMembers.tsx");
      expect(members).toContain('type="password"');
      expect(members).not.toContain('type="text"');
      // Success message must not echo the password variable.
      expect(members).not.toMatch(/Share the password/);
    });
  });
});
