import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { AreaCard } from "@/components/AreaCard";
import { areas } from "@/lib/data";

export const Route = createFileRoute("/areas")({
  head: () => ({
    meta: [
      { title: "Areas — Forever" },
      { name: "description", content: "The Phuket areas Forever reviews through its decision framework." },
      { property: "og:title", content: "Areas — Forever" },
      { property: "og:description", content: "The Phuket areas Forever reviews." },
    ],
  }),
  component: AreasPage,
});

function AreasPage() {
  return (
    <SiteShell>
      <Section
        eyebrow="Neighborhoods"
        title="Phuket areas we review"
        description="Key Phuket areas reviewed through location quality, lifestyle fit, and investment context."
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
