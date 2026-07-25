/**
 * Booth Mode 2.0 light contact + consent contract.
 *
 * Booth-required fields: first name, WhatsApp/phone, preferred language.
 * Everything else is optional. Two consents are DELIBERATELY separate:
 *
 *   • `consultationConsent` — required: permission to save the Decision
 *     Profile and provide the requested consultation through the selected
 *     channel. Without it no contact data is stored.
 *   • `marketingOptIn` — optional, defaults to FALSE, never bundled with the
 *     consultation consent.
 *
 * The website contact form keeps its own stricter validation (surname + email
 * required) in `validateLead` — this module does not touch it.
 */

export const BOOTH_V2_LEAD_SOURCE = "booth_v2";

/** Same phone shape the leads table CHECK enforces. */
export const BOOTH_PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,24}[0-9]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Offered preferred-contact languages (labels only — not a staffing claim). */
export const BOOTH_CONTACT_LANGUAGES = [
  "English",
  "Русский",
  "中文",
  "Deutsch",
  "Français",
  "ไทย",
  "Other",
] as const;

export interface BoothContactV2 {
  firstName: string;
  whatsapp: string;
  preferredLanguage: string;
  lastName: string;
  email: string;
  country: string;
  preferredContactTime: string;
  hostNote: string;
  consultationConsent: boolean;
  marketingOptIn: boolean;
}

export function emptyBoothContact(): BoothContactV2 {
  return {
    firstName: "",
    whatsapp: "",
    preferredLanguage: "",
    lastName: "",
    email: "",
    country: "",
    preferredContactTime: "",
    hostNote: "",
    consultationConsent: false,
    marketingOptIn: false, // marketing is opt-in only and never defaulted on
  };
}

export type BoothContactErrors = Partial<
  Record<"firstName" | "whatsapp" | "preferredLanguage" | "email" | "consultationConsent", string>
>;

export function validateBoothContact(contact: BoothContactV2): BoothContactErrors {
  const errors: BoothContactErrors = {};
  const firstName = contact.firstName.trim();
  const whatsapp = contact.whatsapp.trim();
  const language = contact.preferredLanguage.trim();
  const email = contact.email.trim();

  if (!firstName) errors.firstName = "First name is required.";
  if (!whatsapp) {
    errors.whatsapp = "WhatsApp / phone number is required.";
  } else if (!BOOTH_PHONE_PATTERN.test(whatsapp)) {
    errors.whatsapp = "Enter a valid WhatsApp / phone number.";
  }
  if (!language) errors.preferredLanguage = "Preferred language is required.";
  // Email is OPTIONAL at the booth — validated only when actually provided.
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address, or leave it empty.";
  }
  if (!contact.consultationConsent) {
    errors.consultationConsent =
      "We need your permission to save your Decision Profile and arrange the consultation.";
  }

  return errors;
}

export function hasBoothContactErrors(errors: BoothContactErrors): boolean {
  return Object.keys(errors).length > 0;
}
