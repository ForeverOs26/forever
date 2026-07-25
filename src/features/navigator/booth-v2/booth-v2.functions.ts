/**
 * Booth Mode 2.0 — server function endpoints (pilot).
 *
 * The booth tablet is an unauthenticated kiosk, so these endpoints carry no
 * user identity; trust lives in the server boundary itself: the booth tables
 * accept NO anonymous reads or writes (RLS with no policies), every write
 * goes through the service-role client behind these functions, transitions
 * are validated server-side, and database CHECK constraints back the truthful
 * completion gates. Handlers dynamically import the server module so no
 * service-role code can reach the client bundle; this file carries only
 * wiring and zod validation.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
  .strip();

export const boothV2GetConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { getBoothConfig, runBoothEndpoint } = await import("./server/service");
  return runBoothEndpoint("config", () => getBoothConfig());
});

export const boothV2EnsureSession = createServerFn({ method: "POST" })
  .validator(
    z.object({ clientRef: clientRefSchema, hostLabel: z.string().max(120).optional() }).strip(),
  )
  .handler(async ({ data }) => {
    const { ensureSession, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("session", () =>
      ensureSession({ clientRef: data.clientRef, hostLabel: data.hostLabel ?? null }),
    );
  });

export const boothV2RecordEvent = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        event: z.string().max(60),
        step: z.string().max(120).optional(),
        reason: z.string().max(300).optional(),
      })
      .strip(),
  )
  .handler(async ({ data }) => {
    const { recordFunnelEvent, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("funnel_event", () =>
      recordFunnelEvent({
        clientRef: data.clientRef,
        event: data.event,
        step: data.step ?? null,
        reason: data.reason ?? null,
      }),
    );
  });

export const boothV2ConfirmProfile = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        // The profile payload is re-validated server-side by the fail-closed
        // versioned parser; zod only bounds its transport shape here.
        profile: z.unknown(),
      })
      .strip(),
  )
  .handler(async ({ data }) => {
    const { confirmProfile, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("profile_confirm", () =>
      confirmProfile({ clientRef: data.clientRef, profile: data.profile }),
    );
  });

export const boothV2SetShortlist = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        entries: z
          .array(
            z.object({ slug: z.string().min(1).max(200), mentionedByGuest: z.boolean() }).strip(),
          )
          .max(4),
        guidePrepares: z.boolean(),
      })
      .strip(),
  )
  .handler(async ({ data }) => {
    const { setShortlist, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("shortlist", () => setShortlist(data));
  });

export const boothV2SaveContact = createServerFn({ method: "POST" })
  .validator(z.object({ clientRef: clientRefSchema, contact: contactSchema }).strip())
  .handler(async ({ data }) => {
    const { saveContact, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("contact", () => saveContact(data));
  });

export const boothV2StartWhatsappVerification = createServerFn({ method: "POST" })
  .validator(z.object({ clientRef: clientRefSchema }).strip())
  .handler(async ({ data }) => {
    const { startWhatsappVerification, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("whatsapp_start", () => startWhatsappVerification(data));
  });

export const boothV2ConfirmWhatsappVerification = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        method: z.enum(["wa_me_host_confirmed", "qr_host_confirmed"]),
      })
      .strip(),
  )
  .handler(async ({ data }) => {
    const { confirmWhatsappVerification, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("whatsapp_confirm", () => confirmWhatsappVerification(data));
  });

export const boothV2ListGuides = createServerFn({ method: "GET" }).handler(async () => {
  const { listGuides, runBoothEndpoint } = await import("./server/service");
  return runBoothEndpoint("guides", () => listGuides());
});

export const boothV2AssignGuide = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        guideId: z.string().uuid(),
        reserveGuideId: z.string().uuid().nullable(),
        fallbackReason: z.string().max(300).nullable(),
      })
      .strip(),
  )
  .handler(async ({ data }) => {
    const { assignGuide, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("guide_assign", () => assignGuide(data));
  });

export const boothV2AcknowledgeGuide = createServerFn({ method: "POST" })
  .validator(z.object({ clientRef: clientRefSchema }).strip())
  .handler(async ({ data }) => {
    const { acknowledgeGuide, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("guide_acknowledge", () => acknowledgeGuide(data));
  });

export const boothV2RecordHandoff = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        firstContactConfirmed: z.boolean().optional(),
        consultationScheduledFor: z.string().max(200).nullable().optional(),
        nextStep: z.string().max(500).optional(),
      })
      .strip(),
  )
  .handler(async ({ data }) => {
    const { recordHandoff, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("handoff", () => recordHandoff(data));
  });

export const boothV2CompleteSession = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        outcome: z.enum(["contacted_complete", "no_contact_qr"]),
      })
      .strip(),
  )
  .handler(async ({ data }) => {
    const { completeSession, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("complete", () => completeSession(data));
  });
