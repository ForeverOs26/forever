import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { ContactForm } from "@/components/ContactForm";

/**
 * Optional enquiry context.
 *
 * A project page can send "which project" and "which unit" so the advisor does
 * not have to ask. Both are free text bounded in length and rendered only as
 * text, never as a link or as HTML; anything longer or absent is simply
 * dropped, so a hand-edited URL cannot put arbitrary content on the page.
 */
type ContactSearch = { project?: string; unit?: string };

export const Route = createFileRoute("/contact")({
  // Both keys are genuinely optional — omitted, not set to `undefined` — so
  // every existing `<Link to="/contact">` in the site keeps working unchanged.
  validateSearch: (search: Record<string, unknown>): ContactSearch => {
    const clean = (value: unknown) =>
      typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : undefined;
    const project = clean(search.project);
    const unit = clean(search.unit);
    return { ...(project ? { project } : {}), ...(unit ? { unit } : {}) };
  },
  head: () => ({
    meta: [
      { title: "Contact — Forever" },
      {
        name: "description",
        content: "Contact Forever about Phuket project records and private advisory.",
      },
      { property: "og:title", content: "Contact — Forever" },
      { property: "og:description", content: "Contact Forever about Phuket project records." },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const isPartnerDemo = import.meta.env.DEV && import.meta.env.VITE_PARTNER_DEMO === "true";
  const { project, unit } = Route.useSearch();
  const context = [project, unit ? `unit ${unit}` : null].filter(Boolean).join(" · ");

  return (
    <SiteShell>
      <Section
        eyebrow="Private Client"
        title="Speak with an advisor"
        description={
          isPartnerDemo
            ? "Use this form to demonstrate the advisory handoff. Requests are validated locally and are not saved."
            : "Tell us what you're looking for. We'll come back to you personally, as quickly as we can."
        }
      >
        {context ? (
          <p
            data-testid="contact-enquiry-context"
            className="mb-6 inline-flex rounded-full border border-border bg-secondary px-4 py-2 text-sm text-muted-foreground"
          >
            Enquiry about <span className="ml-1 font-medium text-foreground">{context}</span>
          </p>
        ) : null}
        {/* FOREVER-TRUTH-001A: no office address, email, phone, or opening
            hours are shown until the Owner confirms the exact details — the
            contact form is the supported channel. */}
        <div className="grid gap-10 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <ContactForm source="contact_page" />
          </div>
        </div>
      </Section>
    </SiteShell>
  );
}
