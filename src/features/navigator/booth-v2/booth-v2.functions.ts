/**
 * Booth Mode 2.0 — server function endpoints (pilot).
 *
 * EVERY OPERATIONAL endpoint runs behind requireBoothStaff: the pilot must be
 * explicitly enabled on this deployment (BOOTH_V2_ENABLED, default off), the
 * caller must hold an ACTIVE row in the existing public.studio_members staff
 * roster, AND that row must carry the explicit `can_access_booth` capability.
 * There is no client-supplied Host identity — the Host is the authenticated
 * account itself — and each endpoint is gated independently, so no screen or
 * route decision can substitute for the boundary.
 *
 * THE ONE DELIBERATE EXCEPTION is `boothV2GetRouteAvailability`: an
 * unauthenticated probe that returns a single boolean, whether this deployment
 * has enabled the pilot at all. It exists because item 9 requires /booth-v2 to
 * render the ordinary not-found boundary for a SIGNED-OUT visitor while the
 * pilot is disabled — which the browser cannot know before asking the server.
 * It discloses nothing beyond what an enabled deployment already reveals by
 * showing a staff sign-in form, touches no session, reads no database, and
 * grants nothing.
 *
 * Handlers dynamically import the server module so no service-role code can
 * reach the client bundle; this file carries only wiring and zod validation.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { BOOTH_CLIENT_OBSERVED_EVENTS } from "../core/v2/funnel";
import { requireBoothStaff } from "./booth-auth";

const clientRefSchema = z.string().min(8).max(80);

/**
 * The browser may record ONLY events it genuinely witnessed. Every
 * fact-establishing transition event is emitted by the atomic RPC that performs
 * the transition, so this enum is deliberately narrower than the funnel
 * vocabulary and a transition event is refused here before any handler runs.
 *
 * Exported so the funnel-integrity suite can validate against the REAL schema
 * this endpoint uses rather than a copy of it.
 */
export const boothV2RecordEventInput = z
  .object({
    clientRef: clientRefSchema,
    event: z.enum(BOOTH_CLIENT_OBSERVED_EVENTS),
    step: z.string().max(120).optional(),
    reason: z.string().max(300).optional(),
  })
  .strict();

const shortlistEntriesSchema = z
  .array(z.object({ slug: z.string().min(1).max(200), mentionedByGuest: z.boolean() }).strict())
  .max(4);

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
 * Deployment availability probe — UNAUTHENTICATED BY DESIGN (see the file
 * header). Returns exactly one boolean and nothing else: no session, no
 * database read, no actor, no configuration. When the pilot is disabled the
 * route renders the ordinary not-found boundary for every visitor, signed in
 * or not, so a disabled deployment never shows a Forever Booth login form.
 */
export const boothV2GetRouteAvailability = createServerFn({ method: "GET" }).handler(async () => {
  const { isBoothV2Enabled } = await import("./server/access");
  return { available: isBoothV2Enabled() };
});

/**
 * Access probe for the route shell. It is gated exactly like every other
 * operational endpoint, so a refusal is indistinguishable from "no such page":
 * it returns only whether this caller may operate the booth, never why not.
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

/**
 * SERVER-ISSUED SESSION IDENTITY (PR #102 corrective pass 5).
 *
 * The only endpoint that creates a Booth session, and it deliberately has NO
 * validator because it accepts NO input: a client reference cannot be supplied,
 * proposed or influenced from the browser. The database mints the reference, the
 * Host is the authenticated actor and the booth id is server configuration; the
 * new reference is returned so the tablet can replay it on later operations.
 *
 * One call creates one session and persists nothing about a guest.
 */
export const boothV2CreateSession = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .handler(async ({ context }) => {
    const { createSession, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("session_create", () => createSession(context.actor));
  });

/**
 * Open an EXISTING session. This no longer creates anything: an unknown
 * reference and a reference owned by another Host produce the identical
 * `booth_session_unavailable` refusal and neither writes a row.
 */
export const boothV2EnsureSession = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(z.object({ clientRef: clientRefSchema }).strict())
  .handler(async ({ data, context }) => {
    const { ensureSession, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("session", () => ensureSession(context.actor, data));
  });

/**
 * CLIENT-OBSERVED events only. The validator accepts the three events the
 * tablet is the sole witness to and nothing else: a transition event such as
 * whatsapp_verified, guide_assigned, guide_acknowledged, guide_contacted,
 * consultation_booked, profile_confirmed or qr_continuation is rejected here,
 * then again by the service allowlist, then again by `booth_record_event`
 * itself — so neither an authenticated Host nor a future UI mistake can
 * fabricate transition evidence.
 */
export const boothV2RecordEvent = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(boothV2RecordEventInput)
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

/**
 * Validation only — this endpoint persists NOTHING about the guest. It proves
 * the confirmed profile satisfies the canonical strict schema and records the
 * non-personal funnel fact plus the flow mode. The profile itself stays on the
 * tablet until the guest consents.
 */
export const boothV2MarkProfileConfirmed = createServerFn({ method: "POST" })
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
    const { markProfileConfirmed, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("profile_confirm", () =>
      markProfileConfirmed(context.actor, { clientRef: data.clientRef, profile: data.profile }),
    );
  });

/** Validation only — the shortlist is persisted by the consent transaction. */
export const boothV2ValidateShortlist = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        entries: shortlistEntriesSchema,
        guidePrepares: z.boolean(),
      })
      .strict(),
  )
  .handler(async ({ data, context }) => {
    const { validateShortlistSelection, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("shortlist", () => validateShortlistSelection(context.actor, data));
  });

/**
 * THE consent boundary. The confirmed profile and the shortlist travel WITH the
 * contact bundle because none of them has been persisted before this moment;
 * the server writes them, the consent and exactly one lead in one transaction.
 */
export const boothV2CommitConsent = createServerFn({ method: "POST" })
  .middleware([requireBoothStaff])
  .validator(
    z
      .object({
        clientRef: clientRefSchema,
        profile: z.unknown(),
        entries: shortlistEntriesSchema,
        guidePrepares: z.boolean(),
        contact: contactSchema,
      })
      .strict(),
  )
  .handler(async ({ data, context }) => {
    const { commitConsent, runBoothEndpoint } = await import("./server/service");
    return runBoothEndpoint("consent", () =>
      commitConsent(context.actor, {
        clientRef: data.clientRef,
        // A missing profile is simply an invalid one: the strict schema
        // refuses it, so consent can never be committed without it.
        profile: data.profile,
        entries: data.entries,
        guidePrepares: data.guidePrepares,
        contact: data.contact,
      }),
    );
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
