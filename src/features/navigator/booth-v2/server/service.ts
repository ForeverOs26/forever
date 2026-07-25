/**
 * Booth Mode 2.0 — trusted server boundary (pilot).
 *
 * Every booth_sessions / booth_guides / booth_funnel_events write happens
 * here, through the service-role client. The three booth tables have RLS
 * enabled with NO anonymous policies or grants, so a browser client can never
 * spoof Host/Guide identities, fabricate a verification, or read another
 * guest's session — the only path is these functions, which validate every
 * transition, and the database CHECK constraints back them up.
 *
 * Idempotency: all writes key on the client-generated random `client_ref`
 * (UNIQUE) and funnel events on UNIQUE (session_id, event), so retries never
 * duplicate a session, lead, or event.
 *
 * Fail-closed configuration: the official WhatsApp destination and the dated
 * FX rates are operator-provided env config. When absent, WhatsApp
 * verification reports unavailable (never "verified") and budget comparison
 * stays disabled. Nothing is hard-coded or invented here.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  buildBoothV2Summary,
  buildWaMeHref,
  isBoothFunnelEvent,
  MAX_SHORTLIST,
  parseFxRateConfig,
  parseStoredProfileV2,
  parseWhatsappConfig,
  sessionCodeFromClientRef,
  validateBoothContact,
  hasBoothContactErrors,
  type BoothContactV2,
  type BoothFunnelEvent,
  type BoothGuide,
  type DecisionProfileV2,
  type FxRateConfig,
  type ShortlistV2,
  type WhatsappVerificationMethod,
} from "../../core/v2";
import { BOOTH_V2_LEAD_SOURCE } from "../../core/v2/contact";

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

export async function runBoothEndpoint<T>(context: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof BoothError) throw error;
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

export async function getBoothConfig(): Promise<BoothPublicConfig> {
  return {
    boothId: process.env.BOOTH_ID?.trim() || "unconfigured",
    whatsappConfigured: parseWhatsappConfig(process.env.BOOTH_WHATSAPP_NUMBER) !== null,
    fx: readFxConfig(),
  };
}

/* ---------- Session lifecycle ---------- */

async function requireSession(clientRef: string) {
  const { data, error } = await supabaseAdmin
    .from("booth_sessions")
    .select("*")
    .eq("client_ref", clientRef)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new BoothError("booth_session_not_found", "This booth session no longer exists.");
  return data;
}

export async function ensureSession(input: {
  clientRef: string;
  hostLabel?: string | null;
}): Promise<{ ok: true }> {
  if (isBoothDemoNoWriteMode()) return { ok: true };
  const config = await getBoothConfig();
  const { error } = await supabaseAdmin.from("booth_sessions").upsert(
    {
      client_ref: input.clientRef,
      booth_id: config.boothId,
      host_label: input.hostLabel ?? null,
    },
    { onConflict: "client_ref", ignoreDuplicates: true },
  );
  if (error) throw error;
  return { ok: true };
}

export async function recordFunnelEvent(input: {
  clientRef: string;
  event: string;
  step?: string | null;
  reason?: string | null;
}): Promise<{ ok: true }> {
  if (!isBoothFunnelEvent(input.event)) {
    throw new BoothError("booth_invalid_event", "Unknown funnel event.");
  }
  if (isBoothDemoNoWriteMode()) return { ok: true };
  await ensureSession({ clientRef: input.clientRef });
  const session = await requireSession(input.clientRef);
  const { error } = await supabaseAdmin.from("booth_funnel_events").upsert(
    {
      session_id: session.id,
      event: input.event,
      step: input.step ?? null,
      reason: input.reason ?? null,
    },
    { onConflict: "session_id,event", ignoreDuplicates: true },
  );
  if (error) throw error;
  if (input.event === "session_abandoned" && session.outcome === "active") {
    const { error: updateError } = await supabaseAdmin
      .from("booth_sessions")
      .update({
        outcome: "abandoned",
        abandonment_step: input.step ?? null,
        abandonment_reason: input.reason ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);
    if (updateError) throw updateError;
  }
  return { ok: true };
}

/* ---------- Profile + shortlist ---------- */

export async function confirmProfile(input: {
  clientRef: string;
  profile: unknown;
}): Promise<{ ok: true }> {
  const profile = parseStoredProfileV2(input.profile);
  if (profile === null || profile.confirmedAt === null) {
    throw new BoothError(
      "booth_profile_invalid",
      "The Decision Profile payload is malformed or of an unsupported version.",
    );
  }
  if (isBoothDemoNoWriteMode()) return { ok: true };
  await ensureSession({ clientRef: input.clientRef });
  const { error } = await supabaseAdmin
    .from("booth_sessions")
    .update({
      flow_mode: profile.flowMode,
      profile: profile as unknown as Json,
      profile_version: profile.profileVersion,
      profile_confirmed_at: profile.confirmedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("client_ref", input.clientRef);
  if (error) throw error;
  return { ok: true };
}

export async function setShortlist(input: {
  clientRef: string;
  entries: { slug: string; mentionedByGuest: boolean }[];
  guidePrepares: boolean;
}): Promise<{ ok: true }> {
  if (input.entries.length > MAX_SHORTLIST) {
    throw new BoothError("booth_shortlist_too_long", "A shortlist holds at most four directions.");
  }
  if (isBoothDemoNoWriteMode()) return { ok: true };
  await ensureSession({ clientRef: input.clientRef });
  const { error } = await supabaseAdmin
    .from("booth_sessions")
    .update({
      shortlist: input.entries as unknown as Json,
      shortlist_mode: input.guidePrepares
        ? "guide_prepares"
        : input.entries.length > 0
          ? "guest_selected"
          : "none",
      updated_at: new Date().toISOString(),
    })
    .eq("client_ref", input.clientRef);
  if (error) throw error;
  return { ok: true };
}

/* ---------- Contact + consent + human-readable lead mirror ---------- */

export async function saveContact(input: {
  clientRef: string;
  contact: BoothContactV2;
}): Promise<{ ok: true }> {
  const errors = validateBoothContact(input.contact);
  if (hasBoothContactErrors(errors)) {
    throw new BoothError(
      "booth_contact_invalid",
      "Please check the contact fields — first name, WhatsApp number, language, and the consultation permission are required.",
    );
  }
  if (isBoothDemoNoWriteMode()) return { ok: true };
  await ensureSession({ clientRef: input.clientRef });
  const session = await requireSession(input.clientRef);
  const contact = input.contact;
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("booth_sessions")
    .update({
      first_name: contact.firstName.trim(),
      whatsapp: contact.whatsapp.trim(),
      preferred_language: contact.preferredLanguage.trim(),
      last_name: contact.lastName.trim() || null,
      email: contact.email.trim().toLowerCase() || null,
      country: contact.country.trim() || null,
      preferred_contact_time: contact.preferredContactTime.trim() || null,
      host_note: contact.hostNote.trim() || null,
      consultation_consent: true,
      consent_recorded_at: session.consent_recorded_at ?? now,
      marketing_opt_in: contact.marketingOptIn === true,
      updated_at: now,
    })
    .eq("id", session.id);
  if (error) throw error;

  // Human-readable mirror in the leads list — written once per session.
  if (session.lead_id === null) {
    const profile = parseStoredProfileV2(session.profile);
    const shortlist = readStoredShortlist(session.shortlist, session.shortlist_mode);
    const summary = profile
      ? buildBoothV2Summary({ profile, shortlist, hostNote: contact.hostNote })
      : "— Forever Booth 2.0 — contact saved before a confirmed Decision Profile.";
    const projectSlug = await firstValidProjectSlug(shortlist);
    const { data: lead, error: leadError } = await supabaseAdmin
      .from("leads")
      .insert({
        name: [contact.firstName.trim(), contact.lastName.trim()].filter(Boolean).join(" "),
        email: contact.email.trim().toLowerCase() || null,
        phone: contact.whatsapp.trim(),
        country: contact.country.trim() || null,
        budget: profile ? budgetDisplay(profile) : null,
        interest: profile ? `Booth 2.0 · ${profile.purchasePurpose}` : "Booth 2.0",
        project_slug: projectSlug,
        message: summary,
        status: "new",
        source: BOOTH_V2_LEAD_SOURCE,
      })
      .select("id")
      .single();
    if (leadError) throw leadError;
    const { error: linkError } = await supabaseAdmin
      .from("booth_sessions")
      .update({ lead_id: lead.id, updated_at: new Date().toISOString() })
      .eq("id", session.id);
    if (linkError) throw linkError;
  }
  return { ok: true };
}

function budgetDisplay(profile: DecisionProfileV2): string | null {
  const { budget } = profile;
  if (budget.state !== "stated" || budget.originalCurrency === null) return null;
  const parts = [
    budget.minimum !== null ? budget.minimum.toLocaleString("en-US") : null,
    budget.maximum !== null ? budget.maximum.toLocaleString("en-US") : null,
  ];
  const range =
    parts[0] && parts[1]
      ? `${parts[0]}–${parts[1]}`
      : parts[1]
        ? `up to ${parts[1]}`
        : `from ${parts[0]}`;
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

async function firstValidProjectSlug(shortlist: ShortlistV2): Promise<string | null> {
  const slug = shortlist.entries[0]?.slug;
  if (!slug) return null;
  const { data } = await supabaseAdmin
    .from("projects")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  return data?.slug ?? null;
}

/* ---------- WhatsApp manual verification (fail-closed) ---------- */

export interface WhatsappStartResult {
  configured: boolean;
  waHref: string | null;
  sessionCode: string | null;
}

export async function startWhatsappVerification(input: {
  clientRef: string;
}): Promise<WhatsappStartResult> {
  const config = parseWhatsappConfig(process.env.BOOTH_WHATSAPP_NUMBER);
  if (config === null) {
    // Fail closed: verification is unavailable and is never claimed to have
    // happened. The session records 'unavailable', not 'verified'.
    if (!isBoothDemoNoWriteMode()) {
      await ensureSession({ clientRef: input.clientRef });
      const { error } = await supabaseAdmin
        .from("booth_sessions")
        .update({
          whatsapp_verification_state: "unavailable",
          updated_at: new Date().toISOString(),
        })
        .eq("client_ref", input.clientRef);
      if (error) throw error;
    }
    return { configured: false, waHref: null, sessionCode: null };
  }

  const sessionCode = sessionCodeFromClientRef(input.clientRef);
  if (!isBoothDemoNoWriteMode()) {
    await ensureSession({ clientRef: input.clientRef });
    const session = await requireSession(input.clientRef);
    if (session.whatsapp === null) {
      throw new BoothError(
        "booth_contact_missing",
        "Save the guest's contact details before starting WhatsApp verification.",
      );
    }
    if (session.whatsapp_verification_state !== "verified") {
      const { error } = await supabaseAdmin
        .from("booth_sessions")
        .update({
          whatsapp_verification_state: "pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.id);
      if (error) throw error;
    }
  }
  return { configured: true, waHref: buildWaMeHref(config, sessionCode), sessionCode };
}

export async function confirmWhatsappVerification(input: {
  clientRef: string;
  method: WhatsappVerificationMethod;
}): Promise<{ ok: true; verifiedAt: string }> {
  const now = new Date().toISOString();
  if (isBoothDemoNoWriteMode()) return { ok: true, verifiedAt: now };
  const config = parseWhatsappConfig(process.env.BOOTH_WHATSAPP_NUMBER);
  if (config === null) {
    throw new BoothError(
      "booth_whatsapp_unconfigured",
      "WhatsApp verification is unavailable — no official company number is configured.",
    );
  }
  const session = await requireSession(input.clientRef);
  if (session.whatsapp === null) {
    throw new BoothError(
      "booth_contact_missing",
      "Save the guest's contact details before confirming WhatsApp verification.",
    );
  }
  const { error } = await supabaseAdmin
    .from("booth_sessions")
    .update({
      whatsapp_verification_state: "verified",
      whatsapp_verified_at: session.whatsapp_verified_at ?? now,
      whatsapp_verification_method: input.method,
      updated_at: now,
    })
    .eq("id", session.id);
  if (error) throw error;
  return { ok: true, verifiedAt: session.whatsapp_verified_at ?? now };
}

/* ---------- Guides + warm handoff ---------- */

export async function listGuides(): Promise<BoothGuide[]> {
  if (isBoothDemoNoWriteMode()) return [];
  const { data, error } = await supabaseAdmin
    .from("booth_guides")
    .select("id, display_name, languages, specializations, on_duty")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    languages: row.languages ?? [],
    specializations: row.specializations ?? [],
    onDuty: row.on_duty,
  }));
}

export async function assignGuide(input: {
  clientRef: string;
  guideId: string;
  reserveGuideId: string | null;
  fallbackReason: string | null;
}): Promise<{ ok: true; assignedAt: string }> {
  const now = new Date().toISOString();
  if (isBoothDemoNoWriteMode()) return { ok: true, assignedAt: now };
  const session = await requireSession(input.clientRef);
  const { data: guide, error: guideError } = await supabaseAdmin
    .from("booth_guides")
    .select("id, is_active")
    .eq("id", input.guideId)
    .maybeSingle();
  if (guideError) throw guideError;
  if (!guide || !guide.is_active) {
    throw new BoothError("booth_guide_not_found", "That Guide is not available for assignment.");
  }
  const { error } = await supabaseAdmin
    .from("booth_sessions")
    .update({
      assigned_guide_id: input.guideId,
      reserve_guide_id: input.reserveGuideId,
      guide_assigned_at: now,
      guide_acknowledged_at: null,
      guide_fallback_reason: input.fallbackReason,
      updated_at: now,
    })
    .eq("id", session.id);
  if (error) throw error;
  return { ok: true, assignedAt: now };
}

export async function acknowledgeGuide(input: {
  clientRef: string;
}): Promise<{ ok: true; acknowledgedAt: string }> {
  const now = new Date().toISOString();
  if (isBoothDemoNoWriteMode()) return { ok: true, acknowledgedAt: now };
  const session = await requireSession(input.clientRef);
  if (session.assigned_guide_id === null) {
    throw new BoothError("booth_no_guide", "Assign a Guide before recording an acknowledgement.");
  }
  const { error } = await supabaseAdmin
    .from("booth_sessions")
    .update({
      guide_acknowledged_at: session.guide_acknowledged_at ?? now,
      updated_at: now,
    })
    .eq("id", session.id);
  if (error) throw error;
  return { ok: true, acknowledgedAt: session.guide_acknowledged_at ?? now };
}

export async function recordHandoff(input: {
  clientRef: string;
  firstContactConfirmed?: boolean;
  consultationScheduledFor?: string | null;
  nextStep?: string;
}): Promise<{ ok: true }> {
  if (isBoothDemoNoWriteMode()) return { ok: true };
  const session = await requireSession(input.clientRef);
  const now = new Date().toISOString();
  const patch: Database["public"]["Tables"]["booth_sessions"]["Update"] = { updated_at: now };
  if (input.firstContactConfirmed === true && session.guide_first_contact_at === null) {
    patch.guide_first_contact_at = now;
  }
  if (input.consultationScheduledFor !== undefined) {
    patch.consultation_scheduled_for = input.consultationScheduledFor;
  }
  if (input.nextStep !== undefined) {
    const nextStep = input.nextStep.trim();
    if (nextStep.length === 0) {
      throw new BoothError("booth_next_step_empty", "Record an actual next step.");
    }
    patch.next_step = nextStep;
  }
  const { error } = await supabaseAdmin.from("booth_sessions").update(patch).eq("id", session.id);
  if (error) throw error;
  return { ok: true };
}

/* ---------- Truthful completion ---------- */

export async function completeSession(input: {
  clientRef: string;
  outcome: "contacted_complete" | "no_contact_qr";
}): Promise<{ ok: true }> {
  if (isBoothDemoNoWriteMode()) return { ok: true };
  const session = await requireSession(input.clientRef);
  const now = new Date().toISOString();

  if (input.outcome === "contacted_complete") {
    const blockers: string[] = [];
    if (session.profile_confirmed_at === null) blockers.push("profile not confirmed");
    if (session.whatsapp_verification_state !== "verified") blockers.push("WhatsApp not verified");
    if (session.assigned_guide_id === null) blockers.push("no named Guide assigned");
    if (session.next_step === null) blockers.push("next step not recorded");
    if (session.consultation_scheduled_for === null && session.guide_first_contact_at === null) {
      blockers.push("no exact time recorded and no live Guide contact confirmed");
    }
    if (blockers.length > 0) {
      throw new BoothError(
        "booth_completion_blocked",
        `This session is not complete yet: ${blockers.join("; ")}.`,
      );
    }
  } else {
    // A no-contact continuation must not retain contact data.
    const { error: clearError } = await supabaseAdmin
      .from("booth_sessions")
      .update({
        first_name: null,
        whatsapp: null,
        preferred_language: null,
        last_name: null,
        email: null,
        country: null,
        preferred_contact_time: null,
        host_note: null,
        whatsapp_verification_state: "unverified",
        whatsapp_verified_at: null,
        whatsapp_verification_method: null,
        updated_at: now,
      })
      .eq("id", session.id);
    if (clearError) throw clearError;
  }

  const { error } = await supabaseAdmin
    .from("booth_sessions")
    .update({ outcome: input.outcome, updated_at: now })
    .eq("id", session.id);
  if (error) throw error;
  return { ok: true };
}
