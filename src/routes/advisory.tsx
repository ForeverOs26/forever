import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/advisory")({
  head: () => ({
    meta: [
      { title: "Advisory — Forever" },
      {
        name: "description",
        content: "The Forever Advisor Workspace is being prepared for a later phase.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdvisoryPlaceholderPage,
});

/**
 * FOREVER-TRUTH-001A: the earlier public Advisory Workspace hardcoded a
 * legacy project slug and presented project orderings and evidence-signal
 * claims that no evidence contract supports. The Strategic North Star places
 * the Advisor Workflow in a later phase, so this route is a neutral, noindex
 * placeholder: it queries no project data and makes no claim about any
 * project. The canonical Advisory modules under `src/features/advisory/` are
 * retained unchanged for that later, evidence-bound phase.
 */
function AdvisoryPlaceholderPage() {
  return (
    <SiteShell>
      <Section
        eyebrow="Advisory"
        title="The Advisor Workspace is being prepared"
        description="Forever's advisor tooling returns in a later phase, presenting only evidence-bound project information. Until then, advisory happens in person."
      >
        <div className="max-w-xl rounded-2xl border border-border/60 bg-card p-8">
          <p className="text-sm leading-relaxed text-muted-foreground">
            A Forever advisor can walk you through the current project records, compare the options
            that fit your goals, and be honest about what is not yet known. Send a request and we
            will take it from there.
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
