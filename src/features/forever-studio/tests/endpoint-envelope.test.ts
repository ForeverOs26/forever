/**
 * FOREVER-STUDIO-001 — safe error envelope on EVERY Studio endpoint.
 *
 * runStudioEndpoint wraps every server function handler and the membership
 * middleware: raw Supabase/PostgREST/SQL/storage/filesystem/connection text
 * is logged redacted server-side and only a stable safe code + concise safe
 * message can cross to the browser. Access and Studio errors (already safe)
 * pass through with their codes intact.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { StudioAccessError } from "../server/contracts";
import { runStudioEndpoint, StudioError } from "../server/errors";
import { getOverview, startUploadJob, updateResaleListing } from "../server/service";
import { makeWorld, OWNER } from "./fakes";

const RAW_FAILURE =
  'relation "studio_upload_jobs" does not exist at /home/user/forever/db postgres://user:pw@db:5432/app eyJhbGciOiJI.payload.sig';

describe("Studio endpoint safe error envelope", () => {
  it("replaces a raw infrastructure error with a stable safe code + message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const thrown = await runStudioEndpoint("overview", async () => {
      throw new Error(RAW_FAILURE);
    }).then(
      () => null,
      (error: Error) => error,
    );
    spy.mockRestore();
    expect(thrown).not.toBeNull();
    expect(thrown!.name).toBe("studio_request_failed");
    expect(thrown!.message).toContain("Forever Studio");
    for (const fragment of ["studio_upload_jobs", "/home/user", "postgres://", "eyJ"]) {
      expect(thrown!.message).not.toContain(fragment);
      expect(thrown!.name).not.toContain(fragment);
    }
  });

  it("passes access and Studio errors through with their safe codes", async () => {
    await expect(
      runStudioEndpoint("x", async () => {
        throw new StudioAccessError("studio_owner_required", "Only the Owner may do this.");
      }),
    ).rejects.toMatchObject({ code: "studio_owner_required", name: "studio_owner_required" });
    await expect(
      runStudioEndpoint("x", async () => {
        throw new StudioError("ingest_failed", "The page could not be saved.", true);
      }),
    ).rejects.toMatchObject({ code: "ingest_failed", name: "ingest_failed" });
  });

  it("sanitizes raw failures from read endpoints (overview) end to end", async () => {
    const world = makeWorld();
    world.data.listProjects = async () => {
      throw new Error(RAW_FAILURE);
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const thrown = await runStudioEndpoint("overview", () => getOverview(world.deps, OWNER)).then(
      () => null,
      (error: Error) => error,
    );
    expect(thrown!.message).not.toContain("studio_upload_jobs");
    expect(thrown!.message).not.toContain("postgres://");
    // The true detail was logged server-side, redacted.
    const logged = spy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("endpoint:overview");
    expect(logged).not.toContain("/home/user/forever");
    expect(logged).not.toContain("postgres://user");
    expect(logged).not.toContain("eyJhbGciOiJI");
    spy.mockRestore();
  });

  it("sanitizes raw failures from write endpoints (upload start, resale edit)", async () => {
    const world = makeWorld();
    world.storage.createSignedUpload = async () => {
      throw new Error(`signed upload creation failed (studio-uploads): ${RAW_FAILURE}`);
    };
    world.data.getListingDetail = async () => {
      throw new Error(RAW_FAILURE);
    };
    world.data.listings.push({
      id: "00000000-0000-0000-0000-000000000001",
      slug: "envelope-listing",
      title: "Envelope listing",
      publication_status: "draft",
      project_id: null,
      price: null,
      currency: null,
      photos: [],
      updated_at: null,
    });
    world.data.objectOwners.set("listing:00000000-0000-0000-0000-000000000001", OWNER.userId);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const call of [
      () =>
        runStudioEndpoint("upload_start", () =>
          startUploadJob(world.deps, OWNER, {
            workflow: "new_development",
            files: [{ name: "a.jpg" }],
          }),
        ),
      () =>
        runStudioEndpoint("resale_edit", () =>
          updateResaleListing(world.deps, OWNER, {
            listingId: "00000000-0000-0000-0000-000000000001",
            facts: {},
          }),
        ),
    ]) {
      const thrown = await call().then(
        () => null,
        (error: Error) => error,
      );
      expect(thrown).not.toBeNull();
      expect(thrown!.name).toBe("studio_request_failed");
      expect(thrown!.message).not.toContain("postgres://");
      expect(thrown!.message).not.toContain("/home/user");
    }
    spy.mockRestore();
  });

  it("EVERY server-function handler and the middleware route through the envelope", () => {
    const functions = readFileSync(
      resolve(process.cwd(), "src/features/forever-studio/studio.functions.ts"),
      "utf8",
    );
    const handlerCount = (functions.match(/\.handler\(/g) ?? []).length;
    const wrappedCount = (functions.match(/runStudioEndpoint\(/g) ?? []).length;
    expect(handlerCount).toBeGreaterThanOrEqual(13);
    expect(wrappedCount).toBe(handlerCount);
    // Overview, upload start, processing, automatic resume, project detail,
    // resale detail, edit, publish/unpublish (project + listing), hero image,
    // invitations, and membership toggling each carry a named context.
    for (const context of [
      "overview",
      "upload_start",
      "processing",
      "automatic_resume",
      "project_detail",
      "resale_detail",
      "project_edit",
      "resale_edit",
      "project_publication",
      "listing_publication",
      "hero_image",
      "invitation",
      "membership_toggle",
    ]) {
      expect(functions).toContain(`runStudioEndpoint("${context}"`);
    }
    const auth = readFileSync(
      resolve(process.cwd(), "src/features/forever-studio/studio-auth.ts"),
      "utf8",
    );
    expect(auth).toContain('runStudioEndpoint("membership"');
  });
});
