/**
 * Forever Studio — server function endpoints.
 *
 * Every endpoint runs behind requireStudioMember (JWT + active membership,
 * enforced server-side). Handlers dynamically import the server modules so
 * no service-role code can reach the client bundle; this file itself carries
 * only wiring and zod validation.
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
    return getOverview(context.deps, context.actor);
  });

export const studioStartJob = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(startJobSchema)
  .handler(async ({ data, context }) => {
    const { startUploadJob } = await import("./server/service");
    return startUploadJob(context.deps, context.actor, data);
  });

export const studioProcessJob = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(z.object({ jobId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { processUploadJob } = await import("./server/service");
    return processUploadJob(context.deps, context.actor, data.jobId);
  });

export const studioSetProjectPublication = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(z.object({ slug: z.string(), publish: z.boolean() }))
  .handler(async ({ data, context }) => {
    const { setProjectPublication } = await import("./server/service");
    return setProjectPublication(context.deps, context.actor, data);
  });

export const studioSaveProjectFacts = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(z.object({ slug: z.string(), facts: projectFactsSchema }))
  .handler(async ({ data, context }) => {
    const { saveProjectFacts } = await import("./server/service");
    return saveProjectFacts(context.deps, context.actor, data);
  });

export const studioSetListingPublication = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(z.object({ listingId: z.string().uuid(), publish: z.boolean() }))
  .handler(async ({ data, context }) => {
    const { setListingPublication } = await import("./server/service");
    return setListingPublication(context.deps, context.actor, data);
  });

export const studioUpdateResale = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(z.object({ listingId: z.string().uuid(), facts: resaleFactsSchema }))
  .handler(async ({ data, context }) => {
    const { updateResaleListing } = await import("./server/service");
    return updateResaleListing(context.deps, context.actor, data);
  });

export const studioInviteMember = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(
    z.object({
      email: z.string(),
      password: z.string(),
      displayName: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { inviteMember } = await import("./server/service");
    return inviteMember(context.deps, context.actor, data);
  });

export const studioSetMemberActive = createServerFn({ method: "POST" })
  .middleware([requireStudioMember])
  .validator(z.object({ userId: z.string().uuid(), isActive: z.boolean() }))
  .handler(async ({ data, context }) => {
    const { setMemberActive } = await import("./server/service");
    return setMemberActive(context.deps, context.actor, data);
  });
