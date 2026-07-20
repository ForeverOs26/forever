import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ProjectDetailEngine } from "@/features/project-detail/components/ProjectDetailEngine";
import { projectDetailQuery } from "@/features/project-detail/project-detail-query";
import { buildProjectStructuredData } from "@/features/project-detail/project-structured-data";
import type { ProjectDetail } from "@/features/project-detail/project-detail-types";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/projects/$slug")({
  loader: async ({ context, params }) => {
    const project = await context.queryClient.ensureQueryData(projectDetailQuery(params.slug));
    if (!project) throw notFound();
    return { project };
  },
  head: ({ params, loaderData }) => buildProjectHead(params.slug, loaderData?.project),
  component: ProjectDetailPage,
  notFoundComponent: NotFoundView,
  errorComponent: ErrorView,
});

function buildProjectHead(slug: string, project?: ProjectDetail) {
  const image = project?.media.hero?.url ?? project?.media.gallery[0]?.url;
  const title = project
    ? `${project.core.name} - Forever Project Record`
    : "Project Record - Forever";
  const description = project
    ? [
        project.core.location
          ? `${project.core.name} in ${project.core.location}.`
          : `${project.core.name}.`,
        project.core.tagline ? `${project.core.tagline}.` : null,
        "Forever project record.",
      ]
        .filter(Boolean)
        .join(" ")
    : "Forever project record for a Phuket development.";
  const url = `https://forever-home-core.lovable.app/projects/${slug}`;
  const meta = [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "product" },
    { property: "og:url", content: url },
    ...(image
      ? [
          { property: "og:image", content: image },
          { name: "twitter:image", content: image },
        ]
      : []),
  ];
  const links = [{ rel: "canonical", href: url }];
  const scripts = project ? buildProjectStructuredData(project, url, image) : undefined;

  return { meta, links, scripts };
}

function NotFoundView() {
  const { slug } = Route.useParams();
  return (
    <SiteShell>
      <Section eyebrow="Not found" title="We couldn't find this project record">
        <p className="text-sm text-muted-foreground">
          There is no project record matching "{slug}".
        </p>
        <div className="mt-6">
          <Button asChild>
            <Link to="/projects">Back to all projects</Link>
          </Button>
        </div>
      </Section>
    </SiteShell>
  );
}

function ErrorView({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <SiteShell>
      <Section eyebrow="Something went wrong" title="We couldn't load this project">
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6">
          <Button
            onClick={() => {
              reset();
              router.invalidate();
            }}
          >
            Try again
          </Button>
        </div>
      </Section>
    </SiteShell>
  );
}

function ProjectDetailPage() {
  const { slug } = Route.useParams();
  const { data: project } = useSuspenseQuery(projectDetailQuery(slug));

  if (!project) throw notFound();

  return (
    <SiteShell>
      <ProjectDetailEngine project={project} />
    </SiteShell>
  );
}
