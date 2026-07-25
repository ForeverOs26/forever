/**
 * Booth Mode 2.0 — server function endpoints (pilot).
 *
 * EVERY endpoint runs behind requireBoothStaff: the pilot must be explicitly
 * enabled on this deployment (BOOTH_V2_ENABLED, default off) AND the caller
 * must hold an active row in the existing public.studio_members staff roster.
 * There is no unauthenticated Booth operation and no client-supplied Host
 * identity — the Host is the authenticated account itself.
 *
 * Handlers dynamically import the server module so no service-role code can
 * reach the client bundle; this file carries only wiring and zod validation.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireBoothStaff } from "./booth-auth";

const clientRefSchema = z.string().min(8).max(80);

const contactSchema = z
  .object({
    firstName: z.string().max(120),
    whatsapp: z.string().max(40),
    preferredLanguage: z.string().max(60),
    lastName: z.string().max(120),
    email: z.string().max(200),
    country: z.string().max(120),
    preferredContactTime: z.string().max(200),
    hostNote: z.string().max(2000),
    consultationConsent: z.boolean(),
    marketingOptIn: z.boolean(),
  })
  .strict();

/**
 * Access probe for the route shell. It is gated exactly like every other
 * endpoint, so a refusal is indistinguishable from "no such page": it returns
 * only whether this caller may operate the booth, never why not.
 */
export const boothV2GetAccess = createServerFn({ method: "GET" })
  .middleware([requireBoothStaff])
  .handler(async ({ context }) => ({
    granted: true as const,
    hostName: context.actor.displayName ?? context.actor.email,
  }));

export const boothV2GetConfig = createServerFn({ method: "GET" })
  .middleware([requireBoothStaff])
  .handler(async ({ context }) => {
    const { getBoothConfig, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("config", () => getBoothConfig(context.actor));
  });

export const boothV2EnsureSession = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(z.object({ clientRef: clientRefSchema }).strict())
  .handler(async ({ data, context }) => {
    const { ensureSession, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("session", () => ensureSession(context.actor, data));
  });

export const boothV2RecordEvent = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        event: z.string().max(60),
        step: z.string().max(120).optional(),
        reason: z.string().max(300).optional(),
      })
      .strict(),
  )
  .handler(async ({ data, context }) => {
    const { recordFunnelEvent, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("funnel_event", () =>
      recordFunnelEvent(context.actor, {
        clientRef: data.clientRef,
        event: data.event,
        step: data.step ?? null,
        reason: data.reason ?? null,
      }),
    );
  });

export const boothV2ConfirmProfile = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        // Re-validated server-side by the canonical strict profile schema;
        // zod only bounds its transport shape here.
        profile: z.unknown(),
      })
      .strict(),
  )
  .handler(async ({ data, context }) => {
    const { confirmProfile, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("profile_confirm", () =>
      confirmProfile(context.actor, { clientRef: data.clientRef, profile: data.profile }),
    );
  });

export const boothV2SetShortlist = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        entries: z
          .array(
            z.object({ slug: z.string().min(1).max(200), mentionedByGuest: z.boolean() }).strict(),
          )
          .max(4),
        guidePrepares: z.boolean(),
      })
      .strict(),
  )
  .handler(async ({ data, context }) => {
    const { setShortlist, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("shortlist", () => setShortlist(context.actor, data));
  });

export const boothV2SaveContact = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(z.object({ clientRef: clientRefSchema, contact: contactSchema }).strict())
  .handler(async ({ data, context }) => {
    const { saveContact, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("contact", () => saveContact(context.actor, data));
  });

export const boothV2StartWhatsappVerification = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(z.object({ clientRef: clientRefSchema }).strict())
  .handler(async ({ data, context }) => {
    const { startWhatsappVerification, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("whatsapp_start", () => startWhatsappVerification(context.actor, data));
  });

export const boothV2ConfirmWhatsappVerification = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        method: z.enum(["wa_me_host_confirmed", "qr_host_confirmed"]),
      })
      .strict(),
  )
  .handler(async ({ data, context }) => {
    const { confirmWhatsappVerification, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("whatsapp_confirm", () =>
      confirmWhatsappVerification(context.actor, data),
    );
  });

export const boothV2ListGuides = createServerFn({ method: "GET" })
  .middleware([requireBoothStaff])
  .handler(async ({ context }) => {
    const { listGuides, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("guides", () => listGuides(context.actor));
  });

export const boothV2AssignGuide = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        guideId: z.string().uuid(),
        reserveGuideId: z.string().uuid().nullable(),
        fallbackReason: z.string().max(300).nullable(),
      })
      .strict(),
  )
  .handler(async ({ data, context }) => {
    const { assignGuide, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("guide_assign", () => assignGuide(context.actor, data));
  });

export const boothV2AcknowledgeGuide = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(z.object({ clientRef: clientRefSchema }).strict())
  .handler(async ({ data, context }) => {
    const { acknowledgeGuide, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("guide_acknowledge", () => acknowledgeGuide(context.actor, data));
  });

export const boothV2RecordHandoff = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        firstContactConfirmed: z.boolean().optional(),
        // A structured instant only — free text is refused at the boundary.
        consultationScheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
        consultationTimezone: z.string().max(80).nullable().optional(),
        nextStep: z.string().max(500).optional(),
      })
      .strict(),
  )
  .handler(async ({ data, context }) => {
    const { recordHandoff, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("handoff", () => recordHandoff(context.actor, data));
  });

export const boothV2CompleteSession = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        outcome: z.enum(["contacted_complete", "no_contact_qr"]),
      })
      .strict(),
  )
  .handler(async ({ data, context }) => {
    const { completeSession, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("complete", () => completeSession(context.actor, data));
  });
