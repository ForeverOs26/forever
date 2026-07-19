import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { PremiumProjectCard } from "@/components/PremiumProjectCard";
import { projectListQuery } from "@/lib/project-service";
import { isPartnerDemoModeEnabled } from "@/lib/partner-demo-mode";

export const Route = createFileRoute("/projects/")({
  head: () => ({
    meta: [
      { title: "Projects — Forever" },
      {
        name: "description",
        content: "Explore Forever's current and upcoming residences across six neighborhoods.",
      },
      { property: "og:title", content: "Projects — Forever" },
      { property: "og:description", content: "Current and upcoming Forever residences." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(projectListQuery()),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { data: projects } = useSuspenseQuery(projectListQuery());
  const partnerDemo = import.meta.env.DEV && isPartnerDemoModeEnabled();
  return (
    <SiteShell>
      <Section
        eyebrow={partnerDemo ? "Partner presentation" : "Portfolio"}
        title={partnerDemo ? "Available project records" : "Every Forever project"}
        description={
          partnerDemo
            ? "Modeva is the published record used in this walkthrough. Coralina is clearly marked as an unpublished preview. Missing facts remain unfilled."
            : "Explore verified Phuket projects reviewed through the Forever decision framework."
        }
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <PremiumProjectCard key={p.slug} project={p} />
          ))}
        </div>
      </Section>
    </SiteShell>
  );
}
