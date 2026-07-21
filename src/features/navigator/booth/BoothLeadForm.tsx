import { useId, useState } from "react";

import {
  hasLeadValidationErrors,
  validateLead,
  type LeadValidationErrors,
} from "@/lib/lead-service";
import type { BoothContactDetails, LeadStatus } from "../core";

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  error?: string;
  autoComplete?: string;
  optionalHint?: string;
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  required = false,
  error,
  autoComplete,
  optionalHint,
}: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[13px] font-[600] text-[#3A362E] [font-family:'Hanken_Grotesk',system-ui,sans-serif]"
      >
        {label}
        {required ? <span className="text-[#9C7B4C]"> *</span> : null}
        {optionalHint ? (
          <span className="ml-1 font-[400] text-[#A29C90]">{optionalHint}</span>
        ) : null}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={[
          "min-h-[50px] rounded-[13px] border bg-white px-4 text-[15px] text-[#2A2820] outline-none transition-colors [font-family:'Hanken_Grotesk',system-ui,sans-serif]",
          "focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2",
          error ? "border-[1.5px] border-[#C96F52]" : "border-[#EAE6DE] focus:border-[#D8D2C6]",
        ].join(" ")}
      />
      {error ? (
        <p
          id={errorId}
          className="text-[12.5px] text-[#C96F52] [font-family:'Hanken_Grotesk',system-ui,sans-serif]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

const emptyContact: BoothContactDetails = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  country: "",
  staffNote: "",
};

/**
 * Booth lead capture. Uses the EXISTING lead-service validation contract
 * verbatim; the parent owns the actual `submitLead` call (mocked in tests).
 * Duplicate submit is blocked by the shared `leadStatus` guard.
 */
export function BoothLeadForm({
  status,
  failedBanner,
  onSubmit,
}: {
  status: LeadStatus;
  failedBanner: string | null;
  onSubmit: (contact: BoothContactDetails) => void;
}) {
  const uid = useId();
  const [contact, setContact] = useState<BoothContactDetails>(emptyContact);
  const [errors, setErrors] = useState<LeadValidationErrors>({});

  const submitting = status === "submitting";
  const isDemoMode =
    import.meta.env.DEV &&
    (import.meta.env.VITE_PARTNER_DEMO === "true" ||
      import.meta.env.VITE_DEMO_LEAD_MODE === "true");

  function update<K extends keyof BoothContactDetails>(key: K, value: string) {
    setContact((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return; // duplicate-submit guard
    const nextErrors = validateLead(contact);
    setErrors(nextErrors);
    if (hasLeadValidationErrors(nextErrors)) return;
    onSubmit(contact);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {failedBanner ? (
        <div
          role="alert"
          className="rounded-[13px] border border-[#EAC9BE] bg-[#FBF1ED] px-4 py-3 text-[13.5px] text-[#8A3D24] [font-family:'Hanken_Grotesk',system-ui,sans-serif]"
        >
          {failedBanner}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          id={`${uid}-first`}
          label="First name"
          value={contact.firstName}
          onChange={(value) => update("firstName", value)}
          required
          autoComplete="given-name"
          error={errors.firstName}
        />
        <Field
          id={`${uid}-last`}
          label="Last name"
          value={contact.lastName}
          onChange={(value) => update("lastName", value)}
          required
          autoComplete="family-name"
          error={errors.lastName}
        />
        <Field
          id={`${uid}-email`}
          label="Email"
          type="email"
          value={contact.email}
          onChange={(value) => update("email", value)}
          required
          autoComplete="email"
          error={errors.email}
        />
        <Field
          id={`${uid}-phone`}
          label="Phone"
          type="tel"
          value={contact.phone}
          onChange={(value) => update("phone", value)}
          required
          autoComplete="tel"
          error={errors.phone}
        />
        <Field
          id={`${uid}-country`}
          label="Country"
          value={contact.country ?? ""}
          onChange={(value) => update("country", value)}
          autoComplete="country-name"
          optionalHint="· optional"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${uid}-note`}
          className="text-[13px] font-[600] text-[#3A362E] [font-family:'Hanken_Grotesk',system-ui,sans-serif]"
        >
          Staff note <span className="font-[400] text-[#A29C90]">· optional · internal</span>
        </label>
        <textarea
          id={`${uid}-note`}
          rows={3}
          value={contact.staffNote ?? ""}
          onChange={(event) => update("staffNote", event.target.value)}
          className="resize-none rounded-[13px] border border-[#EAE6DE] bg-white px-4 py-3 text-[15px] text-[#2A2820] outline-none transition-colors focus:border-[#D8D2C6] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 [font-family:'Hanken_Grotesk',system-ui,sans-serif]"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting || undefined}
        className={[
          "min-h-[56px] rounded-[15px] px-4 text-[16px] font-[600] outline-none transition-transform focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 [font-family:'Hanken_Grotesk',system-ui,sans-serif]",
          submitting
            ? "cursor-default bg-[#EDE9E1] text-[#B7B2A6]"
            : "bg-[#17150F] text-white active:translate-y-px",
        ].join(" ")}
      >
        {submitting
          ? isDemoMode
            ? "Validating…"
            : "Saving…"
          : isDemoMode
            ? "Validate contact"
            : "Save lead"}
      </button>
    </form>
  );
}
