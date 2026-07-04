import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { ProjectCard } from "@/components/ProjectCard";
import { projectListQuery } from "@/lib/project-service";

export const Route = createFileRoute("/projects/")({
  head: () => ({
    meta: [
      { title: "Projects — Forever" },
      { name: "description", content: "Explore Forever's current and upcoming residences across six neighborhoods." },
      { property: "og:title", content: "Projects — Forever" },
      { property: "og:description", content: "Current and upcoming Forever residences." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(projectListQuery()),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { data: projects } = useSuspenseQuery(projectListQuery());
  return (
    <SiteShell>
      <Section
        eyebrow="Portfolio"
        title="Every Forever project"
        description="From skyline residences to vineyard estates, each project is designed with a hundred-year view."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.slug} project={p} />
          ))}
        </div>
      </Section>
    </SiteShell>
  );
}