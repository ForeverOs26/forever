import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { AreaCard } from "@/components/AreaCard";
import { areas } from "@/lib/data";

export const Route = createFileRoute("/areas")({
  head: () => ({
    meta: [
      { title: "Areas — Forever" },
      { name: "description", content: "The six neighborhoods where Forever builds — from downtown ridge to vineyard country." },
      { property: "og:title", content: "Areas — Forever" },
      { property: "og:description", content: "The neighborhoods where Forever builds." },
    ],
  }),
  component: AreasPage,
});

function AreasPage() {
  return (
    <SiteShell>
      <Section
        eyebrow="Neighborhoods"
        title="Where Forever builds"
        description="Six areas we return to, again and again — each with a distinct character."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((a) => (
            <AreaCard key={a.slug} area={a} />
          ))}
        </div>
      </Section>
    </SiteShell>
  );
}