import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { SiteShell } from "@/components/SiteShell";
import {
  AdvisoryWorkspace,
  deriveForeverPassport,
  deriveInvestmentIntelligence,
  deriveLocationIntelligence,
  deriveProjectComparison,
  deriveProjectSummary,
  deriveRentalIntelligence,
  mapProjectToAdvisorySession,
  type AdvisoryActionId,
} from "@/features/advisory";
import { projectDetailQuery } from "@/features/project-detail/project-detail-query";
import { ProjectDetailService } from "@/features/project-detail/project-detail-service";
import type { ProjectDetail } from "@/features/project-detail/project-detail-types";
import { ProjectService } from "@/lib/project-service";

/** Active Forever project identity; import-package identity remains `modeva`. */
const ADVISORY_PROJECT_SLUG = "the-modeva-bang-tao";

/**
 * Resolve a second, distinct active project to compare against the primary one.
 * Returns `null` when no second project exists (or the lookup fails), so the
 * Project Comparison section is optional and never breaks the existing page.
 */
async function loadComparisonProject(primarySlug: string): Promise<ProjectDetail | null> {
  try {
    const slugs = await ProjectService.listActiveSlugs();
    const otherSlug = slugs.find((slug) => slug !== primarySlug);
    if (!otherSlug) return null;
    return await ProjectDetailService.getBySlug(otherSlug);
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/advisory")({
  loader: async ({ context }) => {
    const project = await context.queryClient.ensureQueryData(
      projectDetailQuery(ADVISORY_PROJECT_SLUG),
    );
    return {
      project,
      comparisonProject: await loadComparisonProject(ADVISORY_PROJECT_SLUG),
    };
  },
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
  const { project, comparisonProject } = Route.useLoaderData();
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
  const rentalIntelligence = deriveRentalIntelligence(project);
  const locationIntelligence = deriveLocationIntelligence(project);
  const passport = deriveForeverPassport(project);
  const projectSummary = deriveProjectSummary({
    project,
    passport,
    investment: investmentIntelligence,
    rental: rentalIntelligence,
    location: locationIntelligence,
  });

  // Optional: only build the comparison when a second, distinct project exists.
  const projectComparison = comparisonProject
    ? deriveProjectComparison({
        a: { project, passport, summary: projectSummary },
        b: { project: comparisonProject },
      })
    : undefined;

  return (
    <SiteShell>
      <div className="bg-[#F3EFE7] py-6 sm:py-8">
        <AdvisoryWorkspace
          session={session}
          passport={passport}
          projectSummary={projectSummary}
          projectComparison={projectComparison}
          investmentIntelligence={investmentIntelligence}
          rentalIntelligence={rentalIntelligence}
          locationIntelligence={locationIntelligence}
          onAction={handleAction}
        />
      </div>
    </SiteShell>
  );
}
