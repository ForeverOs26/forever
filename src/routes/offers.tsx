import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { OfferCard } from "@/components/OfferCard";
import { offers } from "@/lib/data";

export const Route = createFileRoute("/offers")({
  head: () => ({
    meta: [
      { title: "Verified Offers — Forever" },
      { name: "description", content: "Verified private client offers across current Forever projects." },
      { property: "og:title", content: "Verified Offers — Forever" },
      { property: "og:description", content: "Verified offers on current Forever projects." },
    ],
  }),
  component: OffersPage,
});

function OffersPage() {
  return (
    <SiteShell>
      <Section
        eyebrow="This Season"
        title="Verified client offers"
        description="Curated incentives on select projects, checked by Forever and available by appointment through our advisors."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {offers.map((o) => (
            <OfferCard key={o.id} offer={o} />
          ))}
        </div>
      </Section>
    </SiteShell>
  );
}
