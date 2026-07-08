import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { Container } from "@/components/layout/Container";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — Forever" },
      {
        name: "description",
        content:
          "Forever is an independent Phuket property advisory platform built to reduce uncertainty in real estate decisions.",
      },
      { property: "og:title", content: "About — Forever" },
      {
        property: "og:description",
        content:
          "Independent Phuket property advisory powered by verified project data and structured analysis.",
      },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <SiteShell>
      <section className="border-b border-border/60 bg-secondary/50">
        <Container className="py-24 sm:py-32">
          <div className="mb-4 text-xs font-medium uppercase tracking-[0.3em] text-accent">
            About Forever
          </div>
          <h1 className="max-w-3xl font-serif text-4xl leading-tight tracking-tight text-foreground sm:text-6xl">
            Independent property advisory for clearer decisions.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            Forever helps buyers evaluate Phuket property with verified project data,
            structured analysis, and private advisory support.
          </p>
        </Container>
      </section>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <h2 className="font-serif text-3xl text-foreground">Our approach</h2>
            <p className="mt-4 text-muted-foreground">
              Every Forever review starts with the decision, not the listing. We organize
              project data, verification signals, risks, and buyer-fit evidence so clients
              can understand what supports a property and what uncertainty remains.
            </p>
            <p className="mt-4 text-muted-foreground">
              The platform is demo-ready for Phuket and designed around one principle:
              reduce uncertainty before a buyer takes the next step.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            {[
              ["Verified Data", "Project facts are structured, checked, and kept traceable."],
              ["Clear Analysis", "Scores and recommendations explain the evidence behind them."],
              ["Buyer Fit", "Projects are evaluated against goals, risk, and intended use."],
              ["Private Advisory", "Clients can request a focused review before they act."],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-border/60 bg-card p-6">
                <div className="font-serif text-xl text-foreground">{k}</div>
                <p className="mt-2 text-sm text-muted-foreground">{v}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </SiteShell>
  );
}
