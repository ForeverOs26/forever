/**
 * Booth Mode 2.0 funnel event vocabulary. Only these structured events are
 * recorded — no conversation content, no device metadata, no external
 * analytics platform. Each event is recorded at most once per session
 * (client-side dedupe + a database uniqueness constraint).
 *
 * THE VOCABULARY IS SPLIT BY WHO IS ENTITLED TO ESTABLISH THE FACT
 * (PR #102 corrective pass 3, item 3).
 *
 * A funnel event is either an OBSERVATION the tablet is the only witness to, or
 * EVIDENCE of a state transition the server itself performed. Corrective pass 2
 * left the client-facing endpoint accepting the whole vocabulary, which let an
 * authenticated Host — or a future UI mistake — assert transitions that never
 * happened: a WhatsApp number that was never verified, a Guide who never
 * acknowledged, a consultation that was never booked. The pilot scorecard reads
 * these rows as facts, so a forgeable transition event is a forgeable metric.
 *
 * So the two sets are now disjoint and separately enforced:
 *
 *   • BOOTH_CLIENT_OBSERVED_EVENTS — things only the tablet can see (the
 *     conversation began, the guest started a profile, the session was
 *     abandoned). None of them claims a transition, so a Host asserting one
 *     asserts only what they witnessed.
 *
 *   • every other event is SERVER-ONLY and is emitted inside the same atomic
 *     RPC that establishes the fact, so the evidence and the fact are one write:
 *       profile_confirmed    → booth_mark_profile_confirmed
 *       whatsapp_verified    → booth_set_whatsapp_state
 *       guide_assigned       → booth_assign_guide
 *       guide_acknowledged   → booth_acknowledge_guide
 *       guide_contacted      → booth_record_handoff
 *       consultation_booked  → booth_record_handoff
 *       qr_continuation      → booth_complete_session (no-contact outcome)
 *       viewing_booked       → reserved; nothing emits it yet, and when
 *                              something does it must be the RPC that books the
 *                              viewing, never the browser.
 *
 * The split is enforced independently at four layers — this type, the server
 * function's zod validator, the service allowlist, and the
 * `booth_record_event` database function — so no single mistake re-opens it.
 */

export const BOOTH_FUNNEL_EVENTS = [
  "meaningful_conversation",
  "profile_started",
  "profile_confirmed",
  "whatsapp_verified",
  "guide_assigned",
  "guide_acknowledged",
  "guide_contacted",
  "consultation_booked",
  "qr_continuation",
  "session_abandoned",
  "viewing_booked",
] as const;

export type BoothFunnelEvent = (typeof BOOTH_FUNNEL_EVENTS)[number];

export function isBoothFunnelEvent(value: string): value is BoothFunnelEvent {
  return (BOOTH_FUNNEL_EVENTS as readonly string[]).includes(value);
}

/**
 * The ONLY events a browser may record. Each one is an observation the tablet
 * is genuinely the sole witness to, and none of them establishes a transition.
 */
export const BOOTH_CLIENT_OBSERVED_EVENTS = [
  "meaningful_conversation",
  "profile_started",
  "session_abandoned",
] as const;

export type BoothClientObservedEvent = (typeof BOOTH_CLIENT_OBSERVED_EVENTS)[number];

export function isBoothClientObservedEvent(value: string): value is BoothClientObservedEvent {
  return (BOOTH_CLIENT_OBSERVED_EVENTS as readonly string[]).includes(value);
}

/**
 * Every fact-establishing event. Emitted only by the atomic RPC that performs
 * the transition; a browser presenting one of these is refused at every layer.
 */
export const BOOTH_SERVER_ONLY_EVENTS = BOOTH_FUNNEL_EVENTS.filter(
  (event) => !isBoothClientObservedEvent(event),
) as readonly Exclude<BoothFunnelEvent, BoothClientObservedEvent>[];
