import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/offers")({
  head: () => ({
    meta: [
      { title: "Offers — Forever" },
      {
        name: "description",
        content:
          "Developer offers appear here only when they are confirmed with the developer and source-backed.",
      },
      { property: "og:title", content: "Offers — Forever" },
      {
        property: "og:description",
        content: "Developer offers are published only when confirmed and source-backed.",
      },
    ],
  }),
  component: OffersPage,
});

/**
 * FOREVER-TRUTH-001A: the earlier static "Verified Offer" cards were
 * fabricated promotions for projects that do not exist. Offers are
 * evidence-dependent content — none are published until a real developer
 * offer is confirmed and source-backed.
 */
function OffersPage() {
  return (
    <SiteShell>
      <Section
        eyebrow="Offers"
        title="No published offers right now"
        description="Forever publishes a developer offer only after the terms are confirmed with the developer and recorded with their source. There are no published offers at the moment."
      >
        <div className="max-w-xl rounded-2xl border border-border/60 bg-card p-8">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Developers do run time-limited terms — furniture packages, fee coverage, or early-stage
            pricing. When Forever can confirm one from the developer directly, it will appear here
            with its conditions and validity. Until then, an advisor can check current terms for any
            project you are considering.
          </p>
          <div className="mt-6">
            <Button asChild>
              <Link to="/contact">Ask an advisor about current terms</Link>
            </Button>
          </div>
        </div>
      </Section>
    </SiteShell>
  );
}
