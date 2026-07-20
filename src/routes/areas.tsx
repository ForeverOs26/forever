import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { AreaCard } from "@/components/AreaCard";
import { areas } from "@/lib/data";

export const Route = createFileRoute("/areas")({
  head: () => ({
    meta: [
      { title: "Areas — Forever" },
      {
        name: "description",
        content: "An orientation to the Phuket areas Forever works in.",
      },
      { property: "og:title", content: "Areas — Forever" },
      { property: "og:description", content: "An orientation to Phuket's residential areas." },
    ],
  }),
  component: AreasPage,
});

function AreasPage() {
  return (
    <SiteShell>
      <Section
        eyebrow="Neighborhoods"
        title="Phuket areas in focus"
        description="A short orientation to Phuket's residential areas — geography and character, so a project's location can be read in context."
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
