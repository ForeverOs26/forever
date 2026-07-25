import { useId, useState } from "react";

import {
  BOOTH_CONTACT_LANGUAGES,
  hasBoothContactErrors,
  validateBoothContact,
  type BoothContactErrors,
  type BoothContactV2,
  type ContactTextField,
} from "../core/v2";

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
      <label htmlFor={id} className="text-[13px] font-[600] text-[#3A362E]">
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
          "min-h-[50px] rounded-[13px] border bg-white px-4 text-[15px] text-[#2A2820] outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2",
          error ? "border-[1.5px] border-[#C96F52]" : "border-[#EAE6DE] focus:border-[#D8D2C6]",
        ].join(" ")}
      />
      {error ? (
        <p id={errorId} className="text-[12.5px] text-[#C96F52]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Booth 2.0 light contact form. Required: first name, WhatsApp, preferred
 * language, and the SEPARATE consultation permission. Marketing opt-in is a
 * separate optional checkbox and defaults to unchecked. No surname or email
 * requirement — the website form keeps its own stricter rules.
 */
export function BoothV2ContactForm({
  contact,
  submitting,
  failedBanner,
  onFieldChange,
  onConsentChange,
  onMarketingChange,
  onSubmit,
  onDeclineContact,
}: {
  contact: BoothContactV2;
  submitting: boolean;
  failedBanner: string | null;
  onFieldChange: (field: ContactTextField, value: string) => void;
  onConsentChange: (value: boolean) => void;
  onMarketingChange: (value: boolean) => void;
  onSubmit: () => void;
  onDeclineContact: () => void;
}) {
  const uid = useId();
  const [errors, setErrors] = useState<BoothContactErrors>({});

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return; // duplicate-submit guard
    const nextErrors = validateBoothContact(contact);
    setErrors(nextErrors);
    if (hasBoothContactErrors(nextErrors)) return;
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {failedBanner ? (
        <div
          role="alert"
          className="rounded-[13px] border border-[#EAC9BE] bg-[#FBF1ED] px-4 py-3 text-[13.5px] text-[#8A3D24]"
        >
          {failedBanner}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          id={`${uid}-first`}
          label="First name"
          value={contact.firstName}
          onChange={(value) => onFieldChange("firstName", value)}
          required
          autoComplete="given-name"
          error={errors.firstName}
        />
        <Field
          id={`${uid}-whatsapp`}
          label="WhatsApp / phone"
          type="tel"
          value={contact.whatsapp}
          onChange={(value) => onFieldChange("whatsapp", value)}
          required
          autoComplete="tel"
          error={errors.whatsapp}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-language`} className="text-[13px] font-[600] text-[#3A362E]">
            Preferred language<span className="text-[#9C7B4C]"> *</span>
          </label>
          <select
            id={`${uid}-language`}
            value={contact.preferredLanguage}
            required
            aria-invalid={errors.preferredLanguage ? true : undefined}
            aria-describedby={errors.preferredLanguage ? `${uid}-language-error` : undefined}
            onChange={(event) => onFieldChange("preferredLanguage", event.target.value)}
            className={[
              "min-h-[50px] rounded-[13px] border bg-white px-4 text-[15px] text-[#2A2820] outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2",
              errors.preferredLanguage
                ? "border-[1.5px] border-[#C96F52]"
                : "border-[#EAE6DE] focus:border-[#D8D2C6]",
            ].join(" ")}
          >
            <option value="">Choose…</option>
            {BOOTH_CONTACT_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
          {errors.preferredLanguage ? (
            <p id={`${uid}-language-error`} className="text-[12.5px] text-[#C96F52]">
              {errors.preferredLanguage}
            </p>
          ) : null}
        </div>
        <Field
          id={`${uid}-last`}
          label="Last name"
          value={contact.lastName}
          onChange={(value) => onFieldChange("lastName", value)}
          autoComplete="family-name"
          optionalHint="· optional"
        />
        <Field
          id={`${uid}-email`}
          label="Email"
          type="email"
          value={contact.email}
          onChange={(value) => onFieldChange("email", value)}
          autoComplete="email"
          optionalHint="· optional"
          error={errors.email}
        />
        <Field
          id={`${uid}-country`}
          label="Country"
          value={contact.country}
          onChange={(value) => onFieldChange("country", value)}
          autoComplete="country-name"
          optionalHint="· optional"
        />
        <Field
          id={`${uid}-time`}
          label="Convenient contact time"
          value={contact.preferredContactTime}
          onChange={(value) => onFieldChange("preferredContactTime", value)}
          optionalHint="· optional"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-hostnote`} className="text-[13px] font-[600] text-[#3A362E]">
          Host note <span className="font-[400] text-[#A29C90]">· optional · internal</span>
        </label>
        <textarea
          id={`${uid}-hostnote`}
          rows={2}
          value={contact.hostNote}
          onChange={(event) => onFieldChange("hostNote", event.target.value)}
          className="resize-none rounded-[13px] border border-[#EAE6DE] bg-white px-4 py-3 text-[15px] text-[#2A2820] outline-none transition-colors focus:border-[#D8D2C6] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
        />
      </div>

      <div className="flex flex-col gap-3 rounded-[15px] border border-[#EAE6DE] bg-[#FBFAF7] p-4">
        <label className="flex items-start gap-3 text-[14px] leading-snug text-[#3A362E]">
          <input
            type="checkbox"
            checked={contact.consultationConsent}
            aria-invalid={errors.consultationConsent ? true : undefined}
            aria-describedby={errors.consultationConsent ? `${uid}-consent-error` : undefined}
            onChange={(event) => onConsentChange(event.target.checked)}
            className="mt-0.5 h-5 w-5 accent-[#9C7B4C]"
          />
          <span>
            I agree that Forever saves my Decision Profile and provides the consultation I requested
            through the channel I chose.<span className="text-[#9C7B4C]"> *</span>
          </span>
        </label>
        {errors.consultationConsent ? (
          <p id={`${uid}-consent-error`} className="text-[12.5px] text-[#C96F52]">
            {errors.consultationConsent}
          </p>
        ) : null}
        <label className="flex items-start gap-3 text-[14px] leading-snug text-[#57534A]">
          <input
            type="checkbox"
            checked={contact.marketingOptIn}
            onChange={(event) => onMarketingChange(event.target.checked)}
            className="mt-0.5 h-5 w-5 accent-[#9C7B4C]"
          />
          <span>
            Also send me occasional Forever news and offers{" "}
            <em>(optional — separate from the consultation above)</em>.
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting || undefined}
        className={[
          "min-h-[56px] rounded-[15px] px-4 text-[16px] font-[600] outline-none transition-transform focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2",
          submitting
            ? "cursor-default bg-[#EDE9E1] text-[#B7B2A6]"
            : "bg-[#17150F] text-white active:translate-y-px",
        ].join(" ")}
      >
        {submitting ? "Saving…" : "Save and continue"}
      </button>

      <button
        type="button"
        onClick={onDeclineContact}
        className="min-h-[48px] rounded-[12px] px-4 text-[14.5px] font-[600] text-[#A29C90] outline-none transition-colors hover:text-[#57534A] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
      >
        I&apos;d rather continue on my own — no contact
      </button>
    </form>
  );
}
