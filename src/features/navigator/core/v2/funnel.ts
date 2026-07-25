/**
 * Booth Mode 2.0 funnel event vocabulary. Only these structured events are
 * recorded — no conversation content, no device metadata, no external
 * analytics platform. Each event is recorded at most once per session
 * (client-side dedupe + a database uniqueness constraint).
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
