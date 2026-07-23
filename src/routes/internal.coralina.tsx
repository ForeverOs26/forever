import { createFileRoute, notFound } from "@tanstack/react-router";

import { SiteShell } from "@/components/SiteShell";
import { CoralinaKnowledgePage } from "@/features/coralina-knowledge/components/CoralinaKnowledgePage";

/**
 * Internal inspection route for the Coralina RC5.0 vertical slice.
 *
 * The loader is pure: the slice derives everything from committed repository
 * data (no Supabase, no network), so the page renders identically on every
 * load. The slice module is imported dynamically inside the loader so the
 * foundation chain stays out of the application's shared client bundle and
 * loads only when this internal route is visited. The route is internal
 * tooling — it is excluded from indexing and is not linked from the public
 * navigation or sitemap.
 */
export const Route = createFileRoute("/internal/coralina")({
  loader: async () => {
    if (import.meta.env.DEV) {
      // Served through the RC5.1 catalog so this route and
      // /internal/projects/coralina share one per-process build and cache.
      // The catalog output is pinned equal to getCoralinaKnowledgeInspection().
      const { getProjectKnowledgeInspection } =
        await import("@/features/forever-project-knowledge/catalog");
      const inspection = await getProjectKnowledgeInspection("coralina");
      if (!inspection) throw notFound();
      return { inspection };
    }
    throw notFound();
  },
  head: () => ({
    meta: [
      { title: "Coralina Project Knowledge — Internal Inspection" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content:
          "Internal inspection of the Coralina RC4.4–RC4.9 project knowledge chain built from committed source data.",
      },
    ],
  }),
  component: CoralinaKnowledgeRoute,
  errorComponent: CoralinaKnowledgeError,
});

function CoralinaKnowledgeRoute() {
  const { inspection } = Route.useLoaderData();
  return (
    <SiteShell>
      <CoralinaKnowledgePage inspection={inspection} />
    </SiteShell>
  );
}

function CoralinaKnowledgeError() {
  return (
    <SiteShell>
      <div className="bg-[#F3EFE7] px-4 py-12 text-center text-[#17150F]">
        The Coralina knowledge inspection could not be built from the committed data.
      </div>
    </SiteShell>
  );
}
