/**
 * Forever Studio — server function endpoints.
 *
 * Every endpoint runs behind requireStudioMember (JWT + active membership,
 * enforced server-side) AND inside runStudioEndpoint, the safe error
 * envelope: raw Supabase/PostgREST/SQL/storage/filesystem/connection text is
 * logged redacted server-side and only a stable safe code + concise message
 * ever reaches the browser. Handlers dynamically import the server modules
 * so no service-role code can reach the client bundle; this file itself
 * carries only wiring and zod validation.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireStudioMember } from "./studio-auth";
import { STUDIO_WORKFLOWS, type StudioWorkflow } from "./studio-types";

const projectFactsSchema = z
  .object({
    name: z.string().optional(),
    developerName: z.string().optional(),
    locationText: z.string().optional(),
    projectType: z.string().optional(),
    shortDescription: z.string().optional(),
    fullDescription: z.string().optional(),
    constructionStatus: z.string().optional(),
    ownershipType: z.string().optional(),
    completionDate: z.string().optional(),
    startingPriceThb: z.number().optional(),
    priceRange: z.string().optional(),
    address: z.string().optional(),
  })
  .strip();

const resaleFactsSchema = z
  .object({
    title: z.string().optional(),
    projectName: z.string().optional(),
    locationText: z.string().optional(),
    propertyType: z.string().optional(),
    bedrooms: z.number().optional(),
    bathrooms: z.number().optional(),
    areaSqm: z.number().optional(),
    price: z.number().optional(),
    currency: z.string().optional(),
    description: z.string().optional(),
    contactName: z.string().optional(),
    contactPhone: z.string().optional(),
    contactEmail: z.string().optional(),
  })
  .strip();

const startJobSchema = z
  .object({
    workflow: z.enum(STUDIO_WORKFLOWS as [StudioWorkflow, ...StudioWorkflow[]]),
    projectSlug: z.string().optional(),
    projectFacts: projectFactsSchema.optional(),
    resaleFacts: resaleFactsSchema.optional(),
    files: z
      .array(
        z.object({
          name: z.string(),
          size: z.number().optional(),
          contentType: z.string().optional(),
        }),
      )
      .max(200),
  })
  .strip();

export const studioGetOverview = createServerFn({ method: "GET" })
  .middleware([requireStudioMember])
  .handler(async ({ context }) => {
    const { getOverview } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("overview", () => getOverview(context.deps, context.actor));
  });

export const studioStartJob = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(startJobSchema)
  .handler(async ({ data, context }) => {
    const { startUploadJob } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("upload_start", () =>
      startUploadJob(context.deps, context.actor, data),
    );
  });

export const studioProcessJob = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(z.object({ jobId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { processUploadJob } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("processing", () =>
      processUploadJob(context.deps, context.actor, data.jobId),
    );
  });

const archivePlanSchema = z
  .object({
    jobId: z.string().uuid(),
    fileName: z.string().min(1).max(300),
    declaredSize: z.number().int().positive(),
    // Client upload fingerprint (bounded-sample SHA-256): resume identity so
    // different archives sharing a name and size never attach to each other's
    // stored parts. Recorded privately; never a substitute for server
    // verification of the actual stored bytes.
    uploadFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strip();

const archiveConfirmSchema = z
  .object({
    jobId: z.string().uuid(),
    archiveId: z.string().uuid(),
    partSha256: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .min(1)
      .max(64),
  })
  .strip();

/**
 * Register (or resume) one large-archive chunked upload for an owned job:
 * returns the fixed part geometry, which parts are already stored, and fresh
 * signed targets for the parts that still need bytes.
 */
export const studioPlanArchiveUpload = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(archivePlanSchema)
  .handler(async ({ data, context }) => {
    const { planJobArchiveUpload } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("archive_plan", () =>
      planJobArchiveUpload(context.deps, context.actor, data),
    );
  });

/**
 * Confirm one chunked upload. STORAGE acceptance requires every stored part
 * to exist with exactly the planned size (the browser's claim is never
 * trusted) — that makes the archive safely stored, NOT verified. The
 * recorded per-part SHA-256 claims are verified against the actual stored
 * bytes by the first processing slices; the archive is byte-verified only
 * after every part matches, and no UI may say otherwise.
 */
export const studioConfirmArchiveUpload = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(archiveConfirmSchema)
  .handler(async ({ data, context }) => {
    const { confirmJobArchiveUpload } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("archive_confirm", () =>
      confirmJobArchiveUpload(context.deps, context.actor, data),
    );
  });

/** Durable, public-safe processing progress for one owned job. */
export const studioGetJobProgress = createServerFn({ method: "GET" })
  .middleware([requireStudioMember])
  .validator(z.object({ jobId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { getJobProgress } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("job_progress", () =>
      getJobProgress(context.deps, context.actor, data.jobId),
    );
  });

/**
 * Automatic durable resume from a signed-in Studio session (dashboard poll).
 * The BACKGROUND continuation path is separate and needs no session at all:
 * the Cloudflare Cron Trigger fires the Worker's scheduled() export, which
 * runs runScheduledStudioTick with server-only credentials (see
 * server/scheduled.plugin.ts) — this endpoint is a convenience accelerator,
 * not the guarantee.
 */
export const studioResumePending = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .handler(async ({ context }) => {
    const { resumeDueJobs } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("automatic_resume", () => resumeDueJobs(context.deps, context.actor));
  });

export const studioGetProjectDetail = createServerFn({ method: "GET" })
  .middleware([requireStudioMember])
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data, context }) => {
    const { getProjectDetail } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("project_detail", () =>
      getProjectDetail(context.deps, context.actor, data.slug),
    );
  });

export const studioGetListingDetail = createServerFn({ method: "GET" })
  .middleware([requireStudioMember])
  .validator(z.object({ listingId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { getListingDetail } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("resale_detail", () =>
      getListingDetail(context.deps, context.actor, data.listingId),
    );
  });

export const studioSetHeroImage = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(z.object({ slug: z.string(), url: z.string() }))
  .handler(async ({ data, context }) => {
    const { setProjectHeroImage } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("hero_image", () =>
      setProjectHeroImage(context.deps, context.actor, data),
    );
  });

export const studioSetProjectPublication = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(z.object({ slug: z.string(), publish: z.boolean() }))
  .handler(async ({ data, context }) => {
    const { setProjectPublication } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("project_publication", () =>
      setProjectPublication(context.deps, context.actor, data),
    );
  });

export const studioSaveProjectFacts = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(z.object({ slug: z.string(), facts: projectFactsSchema }))
  .handler(async ({ data, context }) => {
    const { saveProjectFacts } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("project_edit", () =>
      saveProjectFacts(context.deps, context.actor, data),
    );
  });

export const studioSetListingPublication = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(z.object({ listingId: z.string().uuid(), publish: z.boolean() }))
  .handler(async ({ data, context }) => {
    const { setListingPublication } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("listing_publication", () =>
      setListingPublication(context.deps, context.actor, data),
    );
  });

export const studioUpdateResale = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(z.object({ listingId: z.string().uuid(), facts: resaleFactsSchema }))
  .handler(async ({ data, context }) => {
    const { updateResaleListing } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("resale_edit", () =>
      updateResaleListing(context.deps, context.actor, data),
    );
  });

export const studioInviteMember = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(
    z.object({
      email: z.string(),
      // Optional: only needed to create a NEW account. Never displayed,
      // logged, or persisted, and unused when inviting an existing account.
      password: z.string().optional(),
      displayName: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { inviteMember } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("invitation", () => inviteMember(context.deps, context.actor, data));
  });

export const studioSetMemberActive = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(z.object({ userId: z.string().uuid(), isActive: z.boolean() }))
  .handler(async ({ data, context }) => {
    const { setMemberActive } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("membership_toggle", () =>
      setMemberActive(context.deps, context.actor, data),
    );
  });
