import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { SiteShell } from "@/components/SiteShell";
import {
  AdvisoryWorkspace,
  deriveInvestmentIntelligence,
  mapProjectToAdvisorySession,
  type AdvisoryActionId,
} from "@/features/advisory";
import { projectDetailQuery } from "@/features/project-detail/project-detail-query";

/** Active Forever project identity; import-package identity remains `modeva`. */
const ADVISORY_PROJECT_SLUG = "the-modeva-bang-tao";

export const Route = createFileRoute("/advisory")({
  loader: async ({ context }) => ({
    project: await context.queryClient.ensureQueryData(projectDetailQuery(ADVISORY_PROJECT_SLUG)),
  }),
  head: () => ({
    meta: [
      { title: "Forever Advisory Workspace" },
      {
        name: "description",
        content: "Advisory workspace using Forever's verified project data.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,300;6..72,400&display=swap",
      },
    ],
  }),
  component: AdvisoryRoute,
});

function AdvisoryRoute() {
  const { project } = Route.useLoaderData();
  const handleAction = useCallback((actionId: AdvisoryActionId) => {
    console.info("[advisory] action emitted", { actionId });
  }, []);

  if (!project) {
    return (
      <SiteShell>
        <div className="bg-[#F3EFE7] px-4 py-12 text-center text-[#17150F]">
          Advisory project data is unavailable.
        </div>
      </SiteShell>
    );
  }

  const session = mapProjectToAdvisorySession(project);
  const investmentIntelligence = deriveInvestmentIntelligence(project);

  return (
    <SiteShell>
      <div className="bg-[#F3EFE7] py-6 sm:py-8">
        <AdvisoryWorkspace
          session={session}
          investmentIntelligence={investmentIntelligence}
          onAction={handleAction}
        />
      </div>
    </SiteShell>
  );
}
