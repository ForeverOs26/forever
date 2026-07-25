/**
 * Booth Mode 2.0 — trusted server boundary (pilot).
 *
 * Every function here runs ONLY after requireBoothStaff has proven, on the
 * server, that the pilot is enabled and the caller is an active Forever staff
 * member (see server/access.ts). The booth tables carry no anonymous or
 * authenticated privileges at all, so this boundary is the only path to them.
 *
 * State transitions go through the atomic SECURITY DEFINER RPCs added by
 * 20260725150000_booth_v2_pilot.sql: each one locks the session row and
 * performs the whole transition — including its funnel event — in a single
 * transaction. A retry can therefore never create a second lead, a duplicate
 * event, or a partially applied handoff, and the key transition events are
 * emitted by the same operation that establishes the fact rather than by a
 * best-effort client call.
 *
 * Fail-closed configuration: the official WhatsApp destination and the dated
 * FX rates are operator-provided server env. When absent, WhatsApp
 * verification reports unavailable (never "verified") and budget comparison
 * stays disabled. Nothing is hard-coded or invented here.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  buildBoothV2Summary,
  buildWaMeHref,
  hasBoothContactErrors,
  isBoothFunnelEvent,
  MAX_SHORTLIST,
  parseFxRateConfig,
  parseStoredProfileV2,
  parseWhatsappConfig,
  sessionCodeFromClientRef,
  validateBoothContact,
  validateShortlist,
  type BoothContactV2,
  type BoothGuide,
  type DecisionProfileV2,
  type FxRateConfig,
  type HandoffAttributionMethod,
  type ShortlistV2,
  type WhatsappVerificationMethod,
} from "../../core/v2";
import { BOOTH_V2_LEAD_SOURCE } from "../../core/v2/contact";
import { BoothAccessError, type BoothActor } from "./access";

/** A failure with a safe, user-facing surface (name crosses the boundary). */
export class BoothError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = code;
    this.code = code;
  }
}

function redactForLog(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://[redacted]")
    .replace(/https?:\/\/[^\s"']*supabase[^\s"']*/gi, "[supabase-url]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9]+/g, "[key]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+/g, "[jwt]");
}

/** Stable safe codes the RPCs raise; anything else collapses to a generic. */
const RPC_ERROR_MESSAGES: Record<string, string> = {
  booth_session_not_found: "This booth session no longer exists.",
  booth_session_not_active: "This booth session has already been closed.",
  booth_profile_required: "Confirm the Decision Profile before saving contact details.",
  booth_contact_required: "Save the guest's contact details first.",
  booth_guide_required: "Assign a Guide before recording this.",
  booth_guide_not_found: "That Guide is not available for assignment.",
  booth_ack_actor_mismatch:
    "Only the assigned Guide's own account can confirm their acknowledgement.",
  booth_completion_blocked: "This session is not complete yet — check the remaining steps.",
  booth_outcome_invalid: "Unsupported completion outcome.",
};

function mapRpcError(error: { message?: string } | null): never {
  const raw = error?.message ?? "";
  for (const [code, message] of Object.entries(RPC_ERROR_MESSAGES)) {
    if (raw.includes(code)) throw new BoothError(code, message);
  }
  console.error(`[booth-v2] rpc failed: ${redactForLog(raw)}`);
  throw new BoothError(
    "booth_request_failed",
    "The booth hit a temporary problem completing this step. Please try again.",
  );
}

export async function runBoothEndpoint<T>(context: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof BoothError || error instanceof BoothAccessError) throw error;
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[booth-v2] ${context}: ${redactForLog(detail)}`);
    throw new BoothError(
      "booth_request_failed",
      "The booth hit a temporary problem completing this step. Please try again.",
    );
  }
}

/**
 * Dev/demo no-write mode (mirrors the lead-service demo rule, server-side):
 * flows complete without any database access and nothing is persisted.
 */
export function isBoothDemoNoWriteMode(): boolean {
  return process.env.VITE_PARTNER_DEMO === "true" || process.env.VITE_DEMO_LEAD_MODE === "true";
}

/* ---------- Operator configuration (fail-closed) ---------- */

export interface BoothPublicConfig {
  boothId: string;
  whatsappConfigured: boolean;
  fx: FxRateConfig | null;
  /** The signed-in Host, so the shell can show who is operating the booth. */
  hostName: string | null;
}

function readFxConfig(): FxRateConfig | null {
  const raw = process.env.BOOTH_FX_RATES_JSON;
  if (!raw) return null;
  try {
    return parseFxRateConfig(JSON.parse(raw));
  } catch {
    return null; // malformed config disables budget comparison, honestly
  }
}

export async function getBoothConfig(actor: BoothActor): Promise<BoothPublicConfig> {
  return {
    boothId: process.env.BOOTH_ID?.trim() || "unconfigured",
    whatsappConfigured: parseWhatsappConfig(process.env.BOOTH_WHATSAPP_NUMBER) !== null,
    fx: readFxConfig(),
    hostName: actor.displayName ?? actor.email,
  };
}

/* ---------- Session lifecycle ---------- */

// The generated Database types predate the Booth pilot RPCs (the migration is
// unapplied), so RPC calls go through an untyped client and narrow their own
// results — the same pattern the Studio data layer uses.
const rpcClient = supabaseAdmin as unknown as {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
};

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpcClient.rpc(fn, args);
  if (error) mapRpcError(error);
  return data as T;
}

async function readSession(clientRef: string) {
  const { data, error } = await supabaseAdmin
    .from("booth_sessions")
    .select("*")
    .eq("client_ref", clientRef)
    .maybeSingle();
  if (error) mapRpcError(error);
  if (!data)
    throw new BoothError("booth_session_not_found", "This booth session no longer exists.");
  return data;
}

/**
 * Create (or return) the session for this client reference. The Host identity
 * is taken from the authenticated actor — there is no client-supplied host
 * label anywhere in the contract.
 */
export async function ensureSession(
  actor: BoothActor,
  input: { clientRef: string },
): Promise<{ ok: true }> {
  if (isBoothDemoNoWriteMode()) return { ok: true };
  const config = await getBoothConfig(actor);
  await callRpc("booth_ensure_session", {
    p_client_ref: input.clientRef,
    p_host_user_id: actor.userId,
    p_host_email: actor.email,
    p_booth_id: config.boothId,
  });
  return { ok: true };
}

/**
 * Client-observed funnel events only (conversation started, profile started,
 * abandonment, QR continuation). Every transition event — profile confirmed,
 * WhatsApp verified, Guide assigned/acknowledged, first contact, consultation
 * booked, no-contact continuation — is emitted server-side by the RPC that
 * establishes the fact, so a lost client call cannot lose those metrics.
 */
export async function recordFunnelEvent(
  actor: BoothActor,
  input: { clientRef: string; event: string; step?: string | null; reason?: string | null },
): Promise<{ ok: true }> {
  if (!isBoothFunnelEvent(input.event)) {
    throw new BoothError("booth_invalid_event", "Unknown funnel event.");
  }
  if (isBoothDemoNoWriteMode()) return { ok: true };
  await ensureSession(actor, { clientRef: input.clientRef });
  await callRpc("booth_record_event", {
    p_client_ref: input.clientRef,
    p_event: input.event,
    p_step: input.step ?? null,
    p_reason: input.reason ?? null,
  });
  return { ok: true };
}

/* ---------- Profile + shortlist ---------- */

export async function confirmProfile(
  actor: BoothActor,
  input: { clientRef: string; profile: unknown },
): Promise<{ ok: true }> {
  // The canonical strict schema runs again HERE: a payload the browser built
  // is never trusted, and an obsolete or tampered one is refused outright.
  const profile = parseStoredProfileV2(input.profile);
  if (profile === null || profile.confirmedAt === null) {
    throw new BoothError(
      "booth_profile_invalid",
      "The Decision Profile payload is malformed or of an unsupported version.",
    );
  }
  if (isBoothDemoNoWriteMode()) return { ok: true };
  await ensureSession(actor, { clientRef: input.clientRef });
  await callRpc("booth_confirm_profile", {
    p_client_ref: input.clientRef,
    p_flow_mode: profile.flowMode,
    p_profile: profile as unknown as Json,
    p_profile_version: profile.profileVersion,
    p_confirmed_at: profile.confirmedAt,
    p_preferred_language: profile.preferredLanguage,
  });
  return { ok: true };
}

export async function setShortlist(
  actor: BoothActor,
  input: { clientRef: string; entries: ShortlistV2["entries"]; guidePrepares: boolean },
): Promise<{ ok: true }> {
  const shortlist: ShortlistV2 = { entries: input.entries, guidePrepares: input.guidePrepares };
  const invalid = validateShortlist(shortlist);
  if (invalid) {
    // A malformed shortlist is rejected whole — never silently truncated.
    throw new BoothError("booth_shortlist_invalid", `The shortlist is not valid (${invalid}).`);
  }
  if (isBoothDemoNoWriteMode()) return { ok: true };

  // Every selected slug must be a real project; an unknown slug is refused
  // rather than stored as a dangling direction.
  if (shortlist.entries.length > 0) {
    const slugs = shortlist.entries.map((entry) => entry.slug);
    const { data, error } = await supabaseAdmin.from("projects").select("slug").in("slug", slugs);
    if (error) mapRpcError(error);
    const known = new Set((data ?? []).map((row) => row.slug));
    if (slugs.some((slug) => !known.has(slug))) {
      throw new BoothError(
        "booth_shortlist_unknown_project",
        "A selected project no longer exists.",
      );
    }
  }

  await ensureSession(actor, { clientRef: input.clientRef });
  await callRpc("booth_set_shortlist", {
    p_client_ref: input.clientRef,
    p_shortlist: shortlist.entries.slice(0, MAX_SHORTLIST) as unknown as Json,
    p_shortlist_mode: shortlist.guidePrepares
      ? "guide_prepares"
      : shortlist.entries.length > 0
        ? "guest_selected"
        : "none",
  });
  return { ok: true };
}

/* ---------- Contact + consent + the atomic lead mirror ---------- */

export async function saveContact(
  actor: BoothActor,
  input: { clientRef: string; contact: BoothContactV2 },
): Promise<{ ok: true }> {
  const errors = validateBoothContact(input.contact);
  if (hasBoothContactErrors(errors)) {
    throw new BoothError(
      "booth_contact_invalid",
      "Please check the contact fields — first name, WhatsApp number, language, and the consultation permission are required.",
    );
  }
  if (isBoothDemoNoWriteMode()) return { ok: true };

  await ensureSession(actor, { clientRef: input.clientRef });
  const session = await readSession(input.clientRef);
  const profile = parseStoredProfileV2(session.profile);
  if (!profile) {
    throw new BoothError(
      "booth_profile_required",
      "Confirm the Decision Profile before saving contact details.",
    );
  }
  // The contact form may not introduce a language the confirmed profile
  // disagrees with: the persisted profile and the session column are one fact.
  if ((profile.preferredLanguage ?? "") !== input.contact.preferredLanguage.trim()) {
    throw new BoothError(
      "booth_language_mismatch",
      "The preferred language does not match the confirmed Decision Profile.",
    );
  }

  const contact = input.contact;
  const shortlist = readStoredShortlist(session.shortlist, session.shortlist_mode);
  const summary = buildBoothV2Summary({ profile, shortlist, hostNote: contact.hostNote });
  const projectSlug = shortlist.entries[0]?.slug ?? null;

  // ONE transaction: the locked session row, the contact bundle, and
  // create-or-return exactly one lead. A retry returns the same lead id.
  await callRpc("booth_save_contact_and_lead", {
    p_client_ref: input.clientRef,
    p_contact: {
      first_name: contact.firstName.trim(),
      whatsapp: contact.whatsapp.trim(),
      preferred_language: contact.preferredLanguage.trim(),
      last_name: contact.lastName.trim() || null,
      email: contact.email.trim().toLowerCase() || null,
      country: contact.country.trim() || null,
      preferred_contact_time: contact.preferredContactTime.trim() || null,
      host_note: contact.hostNote.trim() || null,
      marketing_opt_in: contact.marketingOptIn === true,
    } as unknown as Json,
    p_lead: {
      name: [contact.firstName.trim(), contact.lastName.trim()].filter(Boolean).join(" "),
      email: contact.email.trim().toLowerCase() || null,
      phone: contact.whatsapp.trim(),
      country: contact.country.trim() || null,
      budget: budgetDisplay(profile),
      interest: `Booth 2.0 · ${profile.purchasePurpose}`,
      project_slug: projectSlug,
      message: summary,
      source: BOOTH_V2_LEAD_SOURCE,
    } as unknown as Json,
  });
  return { ok: true };
}

function budgetDisplay(profile: DecisionProfileV2): string | null {
  const { budget } = profile;
  if (budget.state !== "stated" || budget.originalCurrency === null) return null;
  const min = budget.minimum === null ? null : budget.minimum.toLocaleString("en-US");
  const max = budget.maximum === null ? null : budget.maximum.toLocaleString("en-US");
  const range = min && max ? `${min}–${max}` : max ? `up to ${max}` : `from ${min}`;
  return `${range} ${budget.originalCurrency}`;
}

function readStoredShortlist(raw: unknown, mode: string): ShortlistV2 {
  const entries = Array.isArray(raw)
    ? raw
        .filter(
          (entry): entry is { slug: string; mentionedByGuest?: boolean } =>
            Boolean(entry) &&
            typeof entry === "object" &&
            typeof (entry as { slug?: unknown }).slug === "string",
        )
        .map((entry) => ({ slug: entry.slug, mentionedByGuest: entry.mentionedByGuest === true }))
        .slice(0, MAX_SHORTLIST)
    : [];
  return { entries, guidePrepares: mode === "guide_prepares" };
}

/* ---------- WhatsApp manual verification (fail-closed) ---------- */

export interface WhatsappStartResult {
  configured: boolean;
  waHref: string | null;
  sessionCode: string | null;
}

export async function startWhatsappVerification(
  actor: BoothActor,
  input: { clientRef: string },
): Promise<WhatsappStartResult> {
  const config = parseWhatsappConfig(process.env.BOOTH_WHATSAPP_NUMBER);
  if (config === null) {
    // Fail closed: verification is unavailable and is never claimed to have
    // happened. The session records 'unavailable', not 'verified'.
    if (!isBoothDemoNoWriteMode()) {
      await ensureSession(actor, { clientRef: input.clientRef });
      await callRpc("booth_set_whatsapp_state", {
        p_client_ref: input.clientRef,
        p_state: "unavailable",
        p_method: null,
      });
    }
    return { configured: false, waHref: null, sessionCode: null };
  }

  const sessionCode = sessionCodeFromClientRef(input.clientRef);
  if (!isBoothDemoNoWriteMode()) {
    await ensureSession(actor, { clientRef: input.clientRef });
    const session = await readSession(input.clientRef);
    if (session.whatsapp === null) {
      throw new BoothError(
        "booth_contact_required",
        "Save the guest's contact details before starting WhatsApp verification.",
      );
    }
    await callRpc("booth_set_whatsapp_state", {
      p_client_ref: input.clientRef,
      p_state: "pending",
      p_method: null,
    });
  }
  return { configured: true, waHref: buildWaMeHref(config, sessionCode), sessionCode };
}

export async function confirmWhatsappVerification(
  actor: BoothActor,
  input: { clientRef: string; method: WhatsappVerificationMethod },
): Promise<{ ok: true; verifiedAt: string }> {
  const now = new Date().toISOString();
  if (isBoothDemoNoWriteMode()) return { ok: true, verifiedAt: now };
  if (parseWhatsappConfig(process.env.BOOTH_WHATSAPP_NUMBER) === null) {
    throw new BoothError(
      "booth_whatsapp_unconfigured",
      "WhatsApp verification is unavailable — no official company number is configured.",
    );
  }
  await ensureSession(actor, { clientRef: input.clientRef });
  const verifiedAt = await callRpc<string>("booth_set_whatsapp_state", {
    p_client_ref: input.clientRef,
    p_state: "verified",
    p_method: input.method,
  });
  return { ok: true, verifiedAt: verifiedAt ?? now };
}

/* ---------- Guides + warm handoff ---------- */

export async function listGuides(_actor: BoothActor): Promise<BoothGuide[]> {
  if (isBoothDemoNoWriteMode()) return [];
  const { data, error } = await supabaseAdmin
    .from("booth_guides")
    .select("id, display_name, languages, specializations, on_duty, staff_user_id")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) mapRpcError(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    languages: row.languages ?? [],
    specializations: row.specializations ?? [],
    onDuty: row.on_duty,
    /** True when this Guide can confirm their OWN acknowledgement. */
    hasStaffAccount: row.staff_user_id !== null,
  }));
}

export async function assignGuide(
  actor: BoothActor,
  input: {
    clientRef: string;
    guideId: string;
    reserveGuideId: string | null;
    fallbackReason: string | null;
  },
): Promise<{ ok: true; assignedAt: string }> {
  const now = new Date().toISOString();
  if (isBoothDemoNoWriteMode()) return { ok: true, assignedAt: now };
  await ensureSession(actor, { clientRef: input.clientRef });
  const assignedAt = await callRpc<string>("booth_assign_guide", {
    p_client_ref: input.clientRef,
    p_guide_id: input.guideId,
    p_reserve_guide_id: input.reserveGuideId,
    p_fallback_reason: input.fallbackReason,
  });
  return { ok: true, assignedAt: assignedAt ?? now };
}

/**
 * Record the acknowledgement TRUTHFULLY. The method is derived server-side
 * from who is actually acting: only the assigned Guide's own staff account
 * produces "guide_self_confirmed"; anyone else — including the Host on the
 * tablet — is recorded as a disclosed observation. The RPC re-checks this.
 */
export async function acknowledgeGuide(
  actor: BoothActor,
  input: { clientRef: string },
): Promise<{ ok: true; acknowledgedAt: string; method: HandoffAttributionMethod }> {
  const now = new Date().toISOString();
  if (isBoothDemoNoWriteMode()) {
    return { ok: true, acknowledgedAt: now, method: "host_observed" };
  }
  const session = await readSession(input.clientRef);
  if (session.assigned_guide_id === null) {
    throw new BoothError("booth_guide_required", "Assign a Guide before recording this.");
  }
  const method = await resolveAttributionMethod(actor, session.assigned_guide_id);
  const acknowledgedAt = await callRpc<string>("booth_acknowledge_guide", {
    p_client_ref: input.clientRef,
    p_actor_user_id: actor.userId,
    p_method: method,
  });
  return { ok: true, acknowledgedAt: acknowledgedAt ?? now, method };
}

async function resolveAttributionMethod(
  actor: BoothActor,
  assignedGuideId: string,
): Promise<HandoffAttributionMethod> {
  const { data, error } = await supabaseAdmin
    .from("booth_guides")
    .select("staff_user_id")
    .eq("id", assignedGuideId)
    .maybeSingle();
  if (error) mapRpcError(error);
  return data?.staff_user_id === actor.userId ? "guide_self_confirmed" : "host_observed";
}

export async function recordHandoff(
  actor: BoothActor,
  input: {
    clientRef: string;
    firstContactConfirmed?: boolean;
    consultationScheduledAt?: string | null;
    consultationTimezone?: string | null;
    nextStep?: string;
  },
): Promise<{ ok: true; firstContactMethod: HandoffAttributionMethod | null }> {
  if (isBoothDemoNoWriteMode()) return { ok: true, firstContactMethod: null };
  const session = await readSession(input.clientRef);

  let method: HandoffAttributionMethod | null = null;
  if (input.firstContactConfirmed === true) {
    if (session.assigned_guide_id === null) {
      throw new BoothError("booth_guide_required", "Assign a Guide before recording this.");
    }
    method = await resolveAttributionMethod(actor, session.assigned_guide_id);
  }

  // An exact instant is STRUCTURED and must be a real, plausible future time —
  // free text such as "tomorrow" can never complete a handoff.
  let scheduledAt: string | null = null;
  if (input.consultationScheduledAt) {
    const parsed = Date.parse(input.consultationScheduledAt);
    if (!Number.isFinite(parsed)) {
      throw new BoothError(
        "booth_consultation_time_invalid",
        "Enter the consultation time as an exact date and time.",
      );
    }
    const now = Date.now();
    if (parsed < now - 5 * 60_000) {
      throw new BoothError(
        "booth_consultation_time_past",
        "The consultation time must be in the future.",
      );
    }
    if (parsed > now + 365 * 24 * 60 * 60_000) {
      throw new BoothError(
        "booth_consultation_time_implausible",
        "The consultation time is too far in the future.",
      );
    }
    scheduledAt = new Date(parsed).toISOString();
  }

  if (input.nextStep !== undefined && input.nextStep.trim().length === 0) {
    throw new BoothError("booth_next_step_empty", "Record an actual next step.");
  }

  await callRpc("booth_record_handoff", {
    p_client_ref: input.clientRef,
    p_actor_user_id: actor.userId,
    p_first_contact_method: method,
    p_consultation_scheduled_at: scheduledAt,
    p_consultation_timezone: scheduledAt ? input.consultationTimezone?.trim() || "UTC" : null,
    p_next_step: input.nextStep ?? null,
  });
  return { ok: true, firstContactMethod: method };
}

/* ---------- Truthful completion ---------- */

export async function completeSession(
  actor: BoothActor,
  input: { clientRef: string; outcome: "contacted_complete" | "no_contact_qr" },
): Promise<{ ok: true }> {
  if (isBoothDemoNoWriteMode()) return { ok: true };
  await ensureSession(actor, { clientRef: input.clientRef });
  // One transaction: the gate check (contacted) or the full clear + lead
  // deletion (no-contact) plus the outcome, never two separate updates.
  await callRpc("booth_complete_session", {
    p_client_ref: input.clientRef,
    p_outcome: input.outcome,
  });
  return { ok: true };
}
