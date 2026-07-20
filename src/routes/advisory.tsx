import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { SiteShell } from "@/components/SiteShell";
import {
  AdvisoryWorkspace,
  deriveClientStrategy,
  deriveForeverPassport,
  deriveInvestmentIntelligence,
  deriveLocationIntelligence,
  deriveProjectComparison,
  deriveProjectRecommendations,
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

/**
 * Resolve every active project's detail record so the Project Recommendations
 * section can rank the full candidate set. Failures degrade gracefully to an
 * empty list, so the section never breaks the existing page.
 */
async function loadRecommendationProjects(): Promise<ProjectDetail[]> {
  try {
    const slugs = await ProjectService.listActiveSlugs();
    const details = await Promise.all(
      slugs.map((slug) => ProjectDetailService.getBySlug(slug).catch(() => null)),
    );
    return details.filter((detail): detail is ProjectDetail => detail !== null);
  } catch {
    return [];
  }
}

export const Route = createFileRoute("/advisory")({
  loader: async ({ context }) => {
    const project = await context.queryClient.ensureQueryData(
      projectDetailQuery(ADVISORY_PROJECT_SLUG),
    );
    const [comparisonProject, recommendationProjects] = await Promise.all([
      loadComparisonProject(ADVISORY_PROJECT_SLUG),
      loadRecommendationProjects(),
    ]);
    return {
      project,
      comparisonProject,
      recommendationProjects,
    };
  },
  head: () => ({
    meta: [
      { title: "Forever Advisory Workspace" },
      {
        name: "description",
        content: "Advisory workspace using Forever's recorded project data.",
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
  const { project, comparisonProject, recommendationProjects } = Route.useLoaderData();
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

  // Rank every available project on already-verified evidence coverage only,
  // reusing the primary project's derived Passport / Summary. Falls back to the
  // primary project alone when the candidate lookup yields nothing.
  const candidates = recommendationProjects.length > 0 ? recommendationProjects : [project];
  const projectRecommendations = deriveProjectRecommendations({
    candidates: candidates.map((candidate) =>
      candidate.core.slug === project.core.slug
        ? { project: candidate, passport, summary: projectSummary }
        : { project: candidate },
    ),
  });

  // Compose the Client Strategy from the already-derived Advisory outputs only.
  const clientStrategy = deriveClientStrategy({
    passport,
    summary: projectSummary,
    investment: investmentIntelligence,
    rental: rentalIntelligence,
    location: locationIntelligence,
    comparison: projectComparison,
    recommendations: projectRecommendations,
  });

  return (
    <SiteShell>
      <div className="bg-[#F3EFE7] py-6 sm:py-8">
        <AdvisoryWorkspace
          session={session}
          passport={passport}
          projectSummary={projectSummary}
          projectComparison={projectComparison}
          projectRecommendations={projectRecommendations}
          clientStrategy={clientStrategy}
          investmentIntelligence={investmentIntelligence}
          rentalIntelligence={rentalIntelligence}
          locationIntelligence={locationIntelligence}
          onAction={handleAction}
        />
      </div>
    </SiteShell>
  );
}
