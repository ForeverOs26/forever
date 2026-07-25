/**
 * Pilot WhatsApp verification — manual, configuration-driven, fail-closed.
 *
 * There is NO WhatsApp Business API integration. The pilot flow is:
 * the guest scans a QR / taps a wa.me link to the configurable official
 * company number with a short non-sensitive session code, and the Host
 * confirms the incoming message arrived. Only then is the number verified.
 *
 * When no destination is configured the flow fails closed: verification is
 * reported as unavailable and the number is NEVER claimed to be verified.
 * No number is hard-coded anywhere.
 */

export const WHATSAPP_UNAVAILABLE_MESSAGE =
  "WhatsApp verification is unavailable — no official company WhatsApp number is configured. " +
  "This number has NOT been verified.";

export type WhatsappVerificationState = "unverified" | "pending" | "verified" | "unavailable";

export type WhatsappVerificationMethod = "wa_me_host_confirmed" | "qr_host_confirmed";

export interface WhatsappPilotConfig {
  /** E.164 official company number, operator-configured (never hard-coded). */
  destinationNumber: string;
}

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/** Parse the operator-provided destination. Fail-closed on anything invalid. */
export function parseWhatsappConfig(raw: string | null | undefined): WhatsappPilotConfig | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!E164_PATTERN.test(trimmed)) return null;
  return { destinationNumber: trimmed };
}

/**
 * Short, non-sensitive session code shown in the prefilled message so the Host
 * can pair the incoming WhatsApp message with the current booth session. It is
 * a fragment of the random client reference — no guest data.
 */
export function sessionCodeFromClientRef(clientRef: string): string {
  return clientRef
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .toUpperCase();
}

export function buildWaMeHref(config: WhatsappPilotConfig, sessionCode: string): string {
  const digits = config.destinationNumber.replace(/^\+/, "");
  const text = encodeURIComponent(`Forever booth — session ${sessionCode}`);
  return `https://wa.me/${digits}?text=${text}`;
}
