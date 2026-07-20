import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/reviews")({
  head: () => ({
    meta: [
      { title: "Reviews — Forever" },
      {
        name: "description",
        content:
          "Client reviews are published only with the client's consent after real advisory work.",
      },
      { property: "og:title", content: "Reviews — Forever" },
      {
        property: "og:description",
        content: "Client reviews are published only with consent after real advisory work.",
      },
    ],
  }),
  component: ReviewsPage,
});

/**
 * FOREVER-TRUTH-001A: the earlier static testimonials were fabricated —
 * invented names, ratings, and quotes about projects that do not exist.
 * Reviews are evidence-dependent content — none are published until a real
 * client agrees to publish one.
 */
function ReviewsPage() {
  return (
    <SiteShell>
      <Section
        eyebrow="Client Reviews"
        title="No published reviews yet"
        description="Forever publishes a review only when a real client agrees to share their experience after real advisory work. No reviews are published yet."
      >
        <div className="max-w-xl rounded-2xl border border-border/60 bg-card p-8">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Trust should come from evidence, not manufactured praise. As Forever completes real
            advisory work, reviews will appear here with the client's consent — unedited and
            attributable. In the meantime, the clearest way to evaluate Forever is to look at a
            project record and see exactly what is known, what is missing, and where each fact comes
            from.
          </p>
          <div className="mt-6">
            <Button asChild>
              <Link to="/projects">Browse project records</Link>
            </Button>
          </div>
        </div>
      </Section>
    </SiteShell>
  );
}
