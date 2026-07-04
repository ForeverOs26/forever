import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { Container } from "@/components/layout/Container";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — Forever" },
      { name: "description", content: "Forever is a private developer building residences with a hundred-year view." },
      { property: "og:title", content: "About — Forever" },
      { property: "og:description", content: "A private developer with a hundred-year view." },
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
            A private developer building for the long arc.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            Since 1998 we've built residences one project at a time — with a preference for
            provenance over pace, and permanence over polish.
          </p>
        </Container>
      </section>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <h2 className="font-serif text-3xl text-foreground">Our approach</h2>
            <p className="mt-4 text-muted-foreground">
              Every Forever project begins with the neighborhood, not the site. We spend
              years understanding a place before we break ground, and we design homes that
              will still feel considered fifty years from now.
            </p>
            <p className="mt-4 text-muted-foreground">
              We work with a small circle of architects, craftspeople, and material houses.
              Nothing is off-the-shelf. Everything is warranted for a lifetime.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            {[
              ["Provenance", "Materials with a traceable origin."],
              ["Craft", "Trades we've worked with for decades."],
              ["Longevity", "Buildings warranted for a lifetime."],
              ["Discretion", "Private clients, quietly served."],
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