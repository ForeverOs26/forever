import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ProjectDetailEngine } from "@/features/project-detail/components/ProjectDetailEngine";
import { projectDetailQuery } from "@/features/project-detail/project-detail-query";
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
    ? `${project.core.name} - Forever Advisory Report`
    : "Project Details - Forever";
  const description = project
    ? `${project.core.name} in ${project.core.location}. ${project.core.tagline}.${project.trust.foreverVerified ? " Reviewed by Forever." : " Available project record."}`
    : "Independent Forever advisory report on a Phuket residence.";
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

function buildProjectStructuredData(project: ProjectDetail, url: string, image?: string) {
  const images = image ? [image] : [];
  const additionalProperty = [
    project.trust.trustScore > 0
      ? {
          "@type": "PropertyValue",
          name: "Forever Score",
          value: project.trust.trustScore,
          maxValue: 10,
        }
      : null,
    project.investment.investmentValue > 0
      ? {
          "@type": "PropertyValue",
          name: "Investment Value",
          value: project.investment.investmentValue,
          maxValue: 10,
        }
      : null,
    project.trust.marketPosition
      ? { "@type": "PropertyValue", name: "Market Position", value: project.trust.marketPosition }
      : null,
    project.trust.verdict
      ? { "@type": "PropertyValue", name: "Forever Verdict", value: project.trust.verdict }
      : null,
    project.core.constructionStatus
      ? {
          "@type": "PropertyValue",
          name: "Construction Status",
          value: project.core.constructionStatus,
        }
      : null,
    project.investment.rentalYield
      ? { "@type": "PropertyValue", name: "Rental Yield", value: project.investment.rentalYield }
      : null,
    project.investment.capitalGrowthEstimate
      ? {
          "@type": "PropertyValue",
          name: "Capital Growth Estimate",
          value: project.investment.capitalGrowthEstimate,
        }
      : null,
  ].filter(Boolean);

  return [
    {
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: project.core.name,
        description: project.core.description,
        image: images,
        url,
        category: project.core.type,
        brand: project.developer
          ? { "@type": "Organization", name: project.developer.name }
          : undefined,
        ...(project.pricing.startingPriceTHB > 0
          ? {
              offers: {
                "@type": "Offer",
                price: project.pricing.startingPriceTHB,
                priceCurrency: "THB",
                availability:
                  project.core.status === "Sold Out"
                    ? "https://schema.org/SoldOut"
                    : "https://schema.org/InStock",
                url,
              },
            }
          : {}),
        additionalProperty,
      }),
    },
    {
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Place",
        name: project.core.name,
        description: project.core.tagline,
        image,
        url,
        address: {
          "@type": "PostalAddress",
          addressLocality: project.core.location,
          addressRegion: "Phuket",
          addressCountry: "TH",
        },
      }),
    },
    {
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Projects",
            item: "https://forever-home-core.lovable.app/projects",
          },
          { "@type": "ListItem", position: 2, name: project.core.name, item: url },
        ],
      }),
    },
  ];
}

function NotFoundView() {
  const { slug } = Route.useParams();
  return (
    <SiteShell>
      <Section eyebrow="Not found" title="This project isn't in our advisory list">
        <p className="text-sm text-muted-foreground">
          We couldn't find a Forever-reviewed project matching "{slug}".
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
