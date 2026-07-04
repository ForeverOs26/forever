import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { OfferCard } from "@/components/OfferCard";
import { offers } from "@/lib/data";

export const Route = createFileRoute("/offers")({
  head: () => ({
    meta: [
      { title: "Special Offers — Forever" },
      { name: "description", content: "Time-limited private client packages across current Forever projects." },
      { property: "og:title", content: "Special Offers — Forever" },
      { property: "og:description", content: "Time-limited packages on current Forever residences." },
    ],
  }),
  component: OffersPage,
});

function OffersPage() {
  return (
    <SiteShell>
      <Section
        eyebrow="This Season"
        title="Private client offers"
        description="Curated incentives on select residences. Available by appointment through our advisors."
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