import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { ReviewCard } from "@/components/ReviewCard";
import { reviews } from "@/lib/data";

export const Route = createFileRoute("/reviews")({
  head: () => ({
    meta: [
      { title: "Reviews — Forever" },
      { name: "description", content: "Words from Forever homeowners across our residences and estates." },
      { property: "og:title", content: "Reviews — Forever" },
      { property: "og:description", content: "Words from Forever homeowners." },
    ],
  }),
  component: ReviewsPage,
});

function ReviewsPage() {
  const avg = (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1);
  return (
    <SiteShell>
      <Section
        eyebrow={`${avg} average · ${reviews.length} verified reviews`}
        title="From those who live here"
        description="Unedited words from Forever owners across our projects."
      >
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {reviews.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </div>
      </Section>
    </SiteShell>
  );
}
