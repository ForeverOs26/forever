import { createFileRoute } from "@tanstack/react-router";
import { Mail, MapPin, Phone } from "lucide-react";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { ContactForm } from "@/components/ContactForm";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — Forever" },
      { name: "description", content: "Speak with a Forever private client advisor about current and upcoming residences." },
      { property: "og:title", content: "Contact — Forever" },
      { property: "og:description", content: "Speak with a Forever advisor." },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <SiteShell>
      <Section
        eyebrow="Private Client"
        title="Speak with an advisor"
        description="Tell us what you're looking for. We'll respond within one business day."
      >
        <div className="grid gap-10 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <ContactForm source="contact_page" />
          </div>
          <aside className="lg:col-span-2">
            <div className="rounded-2xl border border-border/60 bg-card p-6">
              <h3 className="font-serif text-2xl text-foreground">Forever Private Office</h3>
              <ul className="mt-6 space-y-4 text-sm">
                <li className="flex items-start gap-3">
                  <MapPin className="mt-0.5 h-4 w-4 text-accent" />
                  <span>Forever Advisory, Phuket, Thailand</span>
                </li>
                <li className="flex items-start gap-3">
                  <Phone className="mt-0.5 h-4 w-4 text-accent" />
                  <span>WhatsApp available on request</span>
                </li>
                <li className="flex items-start gap-3">
                  <Mail className="mt-0.5 h-4 w-4 text-accent" />
                  <span>advisors@forever.property</span>
                </li>
              </ul>
              <div className="mt-6 border-t border-border/60 pt-6 text-xs text-muted-foreground">
                By appointment only, Monday through Saturday.
              </div>
            </div>
          </aside>
        </div>
      </Section>
    </SiteShell>
  );
}
