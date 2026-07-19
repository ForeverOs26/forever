import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  hasLeadValidationErrors,
  isDemoLeadModeEnabled,
  submitLead,
  validateLead,
  type LeadValidationErrors,
} from "@/lib/lead-service";
import { isPartnerDemoModeEnabled } from "@/lib/partner-demo-mode";

type ContactFormProps = {
  defaultInterest?: string;
  projectSlug?: string;
  source?: string;
};

export function ContactForm({
  defaultInterest = "",
  projectSlug,
  source = "contact_form",
}: ContactFormProps) {
  const isPartnerDemo = isPartnerDemoModeEnabled();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<LeadValidationErrors>({});
  const [formError, setFormError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    const form = e.currentTarget;
    const formData = new FormData(form);
    const values = {
      firstName: String(formData.get("firstName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      country: String(formData.get("country") ?? ""),
      budget: String(formData.get("budget") ?? ""),
      interest: String(formData.get("interest") ?? ""),
      projectSlug,
      message: String(formData.get("message") ?? ""),
      source,
    };
    const nextErrors = validateLead(values);
    setErrors(nextErrors);
    setFormError("");

    if (hasLeadValidationErrors(nextErrors)) return;

    setSubmitting(true);
    try {
      await submitLead(values);
      form.reset();
      setSubmitted(true);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "We couldn't submit your request. Please try again in a moment.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-8 text-center">
        <div className="font-serif text-2xl text-foreground">Thank you.</div>
        <p className="mt-2 text-sm text-muted-foreground">
          {isPartnerDemo
            ? "The advisory request passed local validation. No contact details were saved or sent."
            : "A member of our private client team will be in touch within one business day."}
        </p>
        {import.meta.env.DEV && isDemoLeadModeEnabled() && (
          <p className="mt-4 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Presentation mode — this request was validated but not saved.
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-5 rounded-2xl border border-border/60 bg-card p-6 sm:p-8"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            name="firstName"
            required
            autoComplete="given-name"
            aria-invalid={Boolean(errors.firstName)}
            disabled={submitting}
          />
          {errors.firstName && <p className="text-xs text-destructive">{errors.firstName}</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            name="lastName"
            required
            autoComplete="family-name"
            aria-invalid={Boolean(errors.lastName)}
            disabled={submitting}
          />
          {errors.lastName && <p className="text-xs text-destructive">{errors.lastName}</p>}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            disabled={submitting}
          />
          {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            required
            autoComplete="tel"
            aria-invalid={Boolean(errors.phone)}
            disabled={submitting}
          />
          {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="country">Country</Label>
          <Input id="country" name="country" autoComplete="country-name" disabled={submitting} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="budget">Budget</Label>
          <Input id="budget" name="budget" placeholder="e.g. THB 30M" disabled={submitting} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="interest">Interest</Label>
        <Input
          id="interest"
          name="interest"
          defaultValue={defaultInterest}
          placeholder="e.g. Aurora Residences, 3-bed"
          disabled={submitting}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="message">Message</Label>
        <Textarea
          id="message"
          name="message"
          rows={5}
          placeholder="Tell us what you're looking for."
          disabled={submitting}
        />
      </div>
      {formError && (
        <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}
      {import.meta.env.DEV && isDemoLeadModeEnabled() && (
        <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Presentation mode — submissions are validated but not saved.
        </p>
      )}
      <Button type="submit" size="lg" className="justify-self-start" disabled={submitting}>
        {submitting ? "Submitting..." : "Request Private Advisory"}
      </Button>
    </form>
  );
}
