import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { ContactForm } from "@/components/ContactForm";
import { isPartnerDemoModeEnabled } from "@/lib/partner-demo-mode";

export const Route = createFileRoute("/contact")({
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
  const isPartnerDemo = isPartnerDemoModeEnabled();

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
