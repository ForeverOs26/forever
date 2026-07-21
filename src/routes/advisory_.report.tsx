import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/advisory_/report")({
  head: () => ({
    meta: [
      { title: "Advisor Report — Forever" },
      {
        name: "description",
        content: "The Forever advisor report is being prepared for a later phase.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdvisorReportPlaceholderPage,
});

/**
 * FOREVER-TRUTH-001A: the earlier print-ready advisor report hardcoded a
 * legacy project slug and rendered project orderings and evidence-signal
 * language that no evidence contract supports. Like `/advisory`, this route
 * is a neutral, noindex placeholder until the Advisor Workflow phase
 * implements an evidence-bound report. The canonical report modules under
 * `src/features/advisory/` are retained unchanged.
 */
function AdvisorReportPlaceholderPage() {
  return (
    <SiteShell>
      <Section
        eyebrow="Advisor Report"
        title="Advisor reports are being prepared"
        description="Printable advisor reports return in a later phase, built only from evidence-bound project information."
      >
        <div className="max-w-xl rounded-2xl border border-border/60 bg-card p-8">
          <p className="text-sm leading-relaxed text-muted-foreground">
            When advisor reports return, every statement in them will be tied to recorded project
            evidence. In the meantime, an advisor can prepare a personal walkthrough of the current
            project records for you.
          </p>
          <div className="mt-6">
            <Button asChild>
              <Link to="/contact">Request Private Advisory</Link>
            </Button>
          </div>
        </div>
      </Section>
    </SiteShell>
  );
}
