import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type LeadInsert = Database["public"]["Tables"]["leads"]["Insert"];

export type LeadFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country?: string;
  budget?: string;
  interest?: string;
  projectSlug?: string;
  message?: string;
  source?: string;
};

export type LeadValidationErrors = Partial<
  Record<"firstName" | "lastName" | "email" | "phone", string>
>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,24}[0-9]$/;

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

function optional(value: string | undefined): string | null {
  const trimmed = clean(value);
  return trimmed.length > 0 ? trimmed : null;
}

export function validateLead(values: LeadFormValues): LeadValidationErrors {
  const errors: LeadValidationErrors = {};
  const firstName = clean(values.firstName);
  const lastName = clean(values.lastName);
  const email = clean(values.email);
  const phone = clean(values.phone);

  if (!firstName) errors.firstName = "First name is required.";
  if (!lastName) errors.lastName = "Last name is required.";
  if (!email) {
    errors.email = "Email is required.";
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address.";
  }
  if (!phone) {
    errors.phone = "Phone is required.";
  } else if (!PHONE_PATTERN.test(phone)) {
    errors.phone = "Enter a valid phone number.";
  }

  return errors;
}

export function hasLeadValidationErrors(errors: LeadValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Local-development-only no-write lead demo mode.
 *
 * When enabled, `submitLead` runs the normal validation and payload build but
 * stops before the network write, so a local presentation can complete the
 * real lead flow end to end without creating a real lead. This mirrors the
 * demo-preview boundary: every call site guards with a literal
 * `import.meta.env.DEV`, which Vite replaces with `false` in production
 * builds, so the branch (and this helper) is eliminated from the production
 * bundle and production lead behavior is unchanged.
 *
 * Set `VITE_DEMO_LEAD_MODE="false"` in `.env` to restore real lead writes
 * during local development.
 */
export function isDemoLeadModeEnabled(
  env: Pick<ImportMetaEnv, "DEV"> & { VITE_DEMO_LEAD_MODE?: string } = import.meta.env,
): boolean {
  return env.DEV && env.VITE_DEMO_LEAD_MODE !== "false";
}

export async function submitLead(values: LeadFormValues): Promise<void> {
  const errors = validateLead(values);
  if (hasLeadValidationErrors(errors)) {
    throw new Error("Please check the highlighted fields and try again.");
  }

  const firstName = clean(values.firstName);
  const lastName = clean(values.lastName);
  const payload: LeadInsert = {
    name: `${firstName} ${lastName}`.trim(),
    email: clean(values.email).toLowerCase(),
    phone: clean(values.phone),
    country: optional(values.country),
    budget: optional(values.budget),
    interest: optional(values.interest),
    project_slug: optional(values.projectSlug),
    message: optional(values.message),
    status: "new",
    source: clean(values.source) || "contact_form",
  };

  if (import.meta.env.DEV && isDemoLeadModeEnabled()) {
    // Local demo mode: the flow completes normally, but nothing is written
    // and no network call is made.
    console.info("[LeadService] Demo mode — lead validated locally, nothing saved:", payload.name);
    return;
  }

  const { error } = await supabase.from("leads").insert(payload);
  if (error) {
    console.error("[LeadService] Failed to submit lead", error);
    throw new Error("We couldn't submit your request. Please try again in a moment.");
  }
}
