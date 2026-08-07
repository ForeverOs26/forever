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
 *
 * The three endpoints that ALLOCATE an upload — start-job, archive plan and
 * archive confirm — additionally run requireStudioUploadOrigin as their first
 * act, so a request from anywhere but the declared production origin creates no
 * job row, no audit entry, no signed target, no archive row and no multipart
 * upload (Issue #103). Read endpoints are untouched: a version preview stays
 * fully usable for release verification.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireStudioMember } from "./studio-auth";
import {
  STUDIO_MATERIAL_PURPOSES,
  STUDIO_MAX_AMENITY_SORT_ORDER,
  STUDIO_WORKFLOWS,
  type StudioMaterialPurpose,
  type StudioWorkflow,
} from "./studio-types";

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
          // The upload window the Owner chose. A CLOSED allowlist and NOT
          // optional: a missing key, undefined, null, "", whitespace, an
          // unknown value or an arbitrary string all fail validation and the
          // WHOLE request is refused — never stripped, never defaulted, and
          // never quietly replaced by a filename guess. One invalid entry
          // refuses the entire job, before any row or signed target exists.
          // Legacy tolerance lives in the READ path (routingCategoryForFile),
          // which is where a pre-contract manifest is actually encountered.
          materialPurpose: z.enum(
            STUDIO_MATERIAL_PURPOSES as [StudioMaterialPurpose, ...StudioMaterialPurpose[]],
          ),
        }),
      )
      .max(200),
    // Large archives this submission also intends to upload, declared so the
    // WHOLE request can be refused atomically when the resumable lane is
    // unavailable. Held to the same closed purpose allowlist as an ordinary
    // file, and equally incapable of creating anything: archives are planned
    // on their own endpoint, which refuses on its own authority.
    archives: z
      .array(
        z.object({
          name: z.string(),
          size: z.number().optional(),
          materialPurpose: z.enum(
            STUDIO_MATERIAL_PURPOSES as [StudioMaterialPurpose, ...StudioMaterialPurpose[]],
          ),
        }),
      )
      .max(200)
      .optional(),
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
    const { requireStudioUploadOrigin } = await import("./server/upload-origin.server");
    return runStudioEndpoint("upload_start", async () => {
      // Issue #103. The FIRST thing this endpoint does, before the job row,
      // the audit entry and every signed upload target exist: a request that
      // did not come from the declared production origin creates nothing.
      await requireStudioUploadOrigin();
      return startUploadJob(context.deps, context.actor, data);
    });
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

/** Exact-job, read-only observation after one explicit processing request. */
export const studioGetJobStatus = createServerFn({ method: "GET" })
  .middleware([requireStudioMember])
  .validator(z.object({ jobId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { getUploadJobStatus } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("job_status", () =>
      getUploadJobStatus(context.deps, context.actor, data.jobId),
    );
  });

const archivePlanSchema = z
  .object({
    jobId: z.string().uuid(),
    fileName: z.string().min(1).max(300),
    declaredSize: z.number().int().positive(),
    // The Owner's chosen window for THIS archive — the same closed allowlist an
    // ordinary direct file is held to, and equally mandatory. Taking the
    // chunked transport lane is a size decision; it must never cost the archive
    // its semantic purpose, so the purpose crosses the wire here and is refused
    // before an archive row, a signed part target, or any private Storage
    // allocation exists.
    materialPurpose: z.enum(
      STUDIO_MATERIAL_PURPOSES as [StudioMaterialPurpose, ...StudioMaterialPurpose[]],
    ),
    // The exact ordered per-part SHA-256 manifest (every byte of the file
    // hashed part-by-part): the resume identity, so different archives can
    // never attach to each other's stored parts no matter where they differ.
    // Recorded privately; never a substitute for server verification of the
    // actual stored bytes.
    partSha256: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .min(1)
      .max(64),
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
    // R2 multipart receipts. Optional (the Supabase lane has none) and never
    // authoritative: the server lists what storage actually holds and treats a
    // disagreeing claim as a part that still needs bytes. Bounded and
    // character-constrained so an arbitrary string can never reach the
    // completion request body.
    partEtags: z
      .array(
        z.object({
          index: z.number().int().min(0).max(63),
          etag: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[A-Za-z0-9"'._:+/=-]+$/),
        }),
      )
      .max(64)
      .optional(),
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
    const { requireStudioUploadOrigin } = await import("./server/upload-origin.server");
    return runStudioEndpoint("archive_plan", async () => {
      // Issue #103, before the archive row, the multipart upload and every
      // signed part target exist.
      await requireStudioUploadOrigin();
      return planJobArchiveUpload(context.deps, context.actor, data);
    });
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
    const { requireStudioUploadOrigin } = await import("./server/upload-origin.server");
    return runStudioEndpoint("archive_confirm", async () => {
      // Issue #103. Confirmation is the completion half of the SAME multipart
      // allocation planning creates: an origin that may not plan one may not
      // finish one either, and completion is what writes the stored object.
      await requireStudioUploadOrigin();
      return confirmJobArchiveUpload(context.deps, context.actor, data);
    });
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

/** The catalogue plus one project's current amenity selection, for the editor. */
export const studioGetProjectAmenities = createServerFn({ method: "GET" })
  .middleware([requireStudioMember])
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data, context }) => {
    const { getProjectAmenities } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("project_amenities", () =>
      getProjectAmenities(context.deps, context.actor, data),
    );
  });

/**
 * Reconcile one project's amenity set. `amenities` is the EXACT final set — an
 * empty array is a valid save that clears the project's amenities — and
 * `createdAmenities` holds only catalogue rows the Owner explicitly asked to
 * create. The bounds are sanity limits on the request body; the product rules
 * (Owner-only, the 8-featured ceiling, kebab-case slugs, no duplicate or
 * pre-existing slug) are enforced by the service boundary and again inside the
 * transaction, never by this schema.
 */
export const studioSaveProjectAmenities = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(
    z
      .object({
        slug: z.string(),
        amenities: z
          .array(
            z.object({
              slug: z.string().min(1),
              note: z.string(),
              isFeatured: z.boolean(),
              // Bounded, not merely non-negative: a value above int4 would
              // reach the save function's `::integer` cast and raise a raw
              // out-of-range error instead of a named refusal.
              sortOrder: z.number().int().min(0).max(STUDIO_MAX_AMENITY_SORT_ORDER),
            }),
          )
          .max(200),
        createdAmenities: z
          .array(
            z.object({
              name: z.string().min(1),
              slug: z.string().min(1),
              // Required, and narrowed to the supported vocabulary by the
              // service and the save function.
              category: z.string(),
              // Genuinely optional at the wire too: a caller may omit the key
              // entirely, not merely send an empty string. Requiring the key
              // would have made "icon is optional" true of the function and
              // false of the endpoint in front of it.
              icon: z.string().optional().default(""),
            }),
          )
          .max(20),
      })
      .strip(),
  )
  .handler(async ({ data, context }) => {
    const { saveProjectAmenities } = await import("./server/service");
    const { runStudioEndpoint } = await import("./server/errors");
    return runStudioEndpoint("project_amenities_save", () =>
      saveProjectAmenities(context.deps, context.actor, data),
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
