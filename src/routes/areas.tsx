import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/areas")({
  head: () => ({
    meta: [
      { title: "Areas — Forever" },
      {
        name: "description",
        content: "Forever publishes an area guide only once its facts are source-backed.",
      },
      { property: "og:title", content: "Areas — Forever" },
      {
        property: "og:description",
        content: "Area guides are published only once their facts are source-backed.",
      },
    ],
  }),
  component: AreasPage,
});

/**
 * FOREVER-TRUTH-001A: the earlier static area guide carried unverifiable
 * factual and qualitative claims (sheltered beaches, travel times,
 * international schools, branded resorts, deep-water access, residence
 * patterns) and invented listing counts, with no source model behind them.
 * Area guides are evidence-dependent content — none are published until a
 * source-backed Area model exists.
 */
function AreasPage() {
  return (
    <SiteShell>
      <Section
        eyebrow="Areas"
        title="Area guides are being prepared"
        description="Forever publishes an area guide only once its facts are source-backed. No area guides are published yet."
      >
        <div className="max-w-xl rounded-2xl border border-border/60 bg-card p-8">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Phuket&apos;s areas differ in character, access, and pace, and that context matters for
            a project decision. Rather than publish unsourced summaries, Forever will add each area
            guide as its facts are gathered and recorded. Until then, an advisor can talk through
            the areas relevant to the projects you are considering.
          </p>
          <div className="mt-6">
            <Button asChild>
              <Link to="/contact">Ask an advisor about an area</Link>
            </Button>
          </div>
        </div>
      </Section>
    </SiteShell>
  );
}
