import { createFileRoute, notFound } from "@tanstack/react-router";

import { SiteShell } from "@/components/SiteShell";
import { ProjectKnowledgePage } from "@/features/forever-project-knowledge/components/ProjectKnowledgePage";

/**
 * Internal inspection route for the RC5.1 project knowledge engine — one
 * page for every project with a stated knowledge definition
 * (`/internal/projects/coralina`, `/internal/projects/modeva`, …).
 *
 * The loader is pure: each definition derives everything from committed
 * repository data (no Supabase, no network), so the page renders identically
 * on every load. The catalog is imported dynamically inside the loader so
 * the foundation chain and the per-project definitions stay out of the
 * application's shared client bundle and load only when this internal route
 * is visited. The route is internal tooling — it is excluded from indexing
 * and is not linked from the public navigation or sitemap.
 */
export const Route = createFileRoute("/internal/projects/$slug")({
  loader: async ({ params }) => {
    if (import.meta.env.DEV) {
      const { getProjectKnowledgeInspection } =
        await import("@/features/forever-project-knowledge/catalog");
      const inspection = await getProjectKnowledgeInspection(params.slug);
      if (!inspection) throw notFound();
      return { inspection };
    }
    throw notFound();
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        // The loader has no data when it threw notFound() — no uncatalogued
        // slug may be presented in the title as if it were an inspected project.
        title: loaderData
          ? `${loaderData.inspection.projectName} — Project Knowledge — Internal Inspection`
          : "Project Knowledge — Internal Inspection",
      },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content:
          "Internal inspection of a project's RC4.4–RC4.9 knowledge chain built from committed source data.",
      },
    ],
  }),
  component: ProjectKnowledgeRoute,
  // notFound() thrown by the loader is not an error: it renders this
  // component, while errorComponent covers genuine build failures.
  notFoundComponent: ProjectKnowledgeNotFound,
  errorComponent: ProjectKnowledgeError,
});

function ProjectKnowledgeRoute() {
  const { inspection } = Route.useLoaderData();
  return (
    <SiteShell>
      <ProjectKnowledgePage inspection={inspection} />
    </SiteShell>
  );
}

function ProjectKnowledgeNotFound() {
  return (
    <SiteShell>
      <div className="bg-[#F3EFE7] px-4 py-12 text-center text-[#17150F]">
        No project knowledge definition is catalogued for this slug.
      </div>
    </SiteShell>
  );
}

function ProjectKnowledgeError() {
  return (
    <SiteShell>
      <div className="bg-[#F3EFE7] px-4 py-12 text-center text-[#17150F]">
        The project knowledge inspection could not be built from the committed data.
      </div>
    </SiteShell>
  );
}
