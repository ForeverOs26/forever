import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { ProjectDetailEngine } from "@/features/project-detail/components/ProjectDetailEngine";
import { loadProjectDetailRouteData } from "@/features/project-detail/project-detail-route-loader";
import {
  buildProjectStructuredData,
  projectPublicFactDescription,
} from "@/features/project-detail/project-structured-data";
import {
  publicProjectSocialImage,
  type PublicProjectDetailDTO,
} from "@/features/project-detail/public-project-detail";
import { SiteShell } from "@/components/SiteShell";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";
import { PUBLIC_SITE_ORIGIN } from "@/lib/sitemap";

export const Route = createFileRoute("/projects/$slug")({
  loader: ({ context, params }) => loadProjectDetailRouteData(context.queryClient, params.slug),
  head: ({ params, loaderData }) => buildProjectHead(params.slug, loaderData?.project),
  component: ProjectDetailPage,
  notFoundComponent: NotFoundView,
  errorComponent: ErrorView,
});

function buildProjectHead(slug: string, project?: PublicProjectDetailDTO) {
  // The same filtered photograph list the page itself renders. Not a second
  // "hero ?? gallery[0]" of its own — that expression is how a reader drifts.
  const image = project ? (publicProjectSocialImage(project) ?? undefined) : undefined;
  const title = project ? `${project.name} - Forever Project Record` : "Project Record - Forever";
  const description = project
    ? projectPublicFactDescription(project)
    : "Forever project record for a Phuket development.";
  const url = `${PUBLIC_SITE_ORIGIN}/projects/${slug}`;
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

function ErrorView({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <SiteShell>
      <Section eyebrow="Something went wrong" title="We couldn't load this project">
        <p className="text-sm text-muted-foreground">
          The public project record is temporarily unavailable.
        </p>
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
  const { project, relatedProjects } = Route.useLoaderData();

  if (!project) throw notFound();

  return (
    <SiteShell>
      <ProjectDetailEngine
        project={project}
        relatedProjects={relatedProjects.map((related) => ({
          slug: related.slug,
          name: related.name,
          location: related.location,
          // This query's contract already filtered these two states at both
          // the database and defensive mapping boundaries.
          isPublished: true,
          isActive: true,
        }))}
      />
    </SiteShell>
  );
}
