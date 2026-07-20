import { createFileRoute } from "@tanstack/react-router";

import { SiteShell } from "@/components/SiteShell";
import {
  AdvisorReport,
  deriveAdvisorReport,
  deriveForeverPassport,
  deriveInvestmentIntelligence,
  deriveLocationIntelligence,
  deriveProjectComparison,
  deriveProjectRecommendations,
  deriveProjectSummary,
  deriveRentalIntelligence,
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
 * Project Comparison section stays optional and never breaks the report.
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
 * empty list, so the section never breaks the report.
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

export const Route = createFileRoute("/advisory_/report")({
  loader: async ({ context }) => {
    const project = await context.queryClient.ensureQueryData(
      projectDetailQuery(ADVISORY_PROJECT_SLUG),
    );
    const [comparisonProject, recommendationProjects] = await Promise.all([
      loadComparisonProject(ADVISORY_PROJECT_SLUG),
      loadRecommendationProjects(),
    ]);
    return { project, comparisonProject, recommendationProjects };
  },
  head: () => ({
    meta: [
      { title: "Forever Advisor Report" },
      {
        name: "description",
        content: "Print-ready Forever advisory report composed from recorded project evidence.",
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
  component: AdvisorReportRoute,
});

function AdvisorReportRoute() {
  const { project, comparisonProject, recommendationProjects } = Route.useLoaderData();

  if (!project) {
    return (
      <SiteShell>
        <div className="bg-[#F3EFE7] px-4 py-12 text-center text-[#17150F]">
          Advisory report data is unavailable.
        </div>
      </SiteShell>
    );
  }

  const investment = deriveInvestmentIntelligence(project);
  const rental = deriveRentalIntelligence(project);
  const location = deriveLocationIntelligence(project);
  const passport = deriveForeverPassport(project);
  const summary = deriveProjectSummary({ project, passport, investment, rental, location });

  // Optional: only build the comparison when a second, distinct project exists.
  const comparison = comparisonProject
    ? deriveProjectComparison({
        a: { project, passport, summary },
        b: { project: comparisonProject },
      })
    : undefined;

  // Rank every available project on already-verified evidence coverage only,
  // reusing the primary project's derived Passport / Summary.
  const candidates = recommendationProjects.length > 0 ? recommendationProjects : [project];
  const recommendations = deriveProjectRecommendations({
    candidates: candidates.map((candidate) =>
      candidate.core.slug === project.core.slug
        ? { project: candidate, passport, summary }
        : { project: candidate },
    ),
  });

  const report = deriveAdvisorReport({
    project,
    passport,
    summary,
    investment,
    rental,
    location,
    comparison,
    recommendations,
  });

  return (
    <SiteShell>
      <AdvisorReport data={report} />
    </SiteShell>
  );
}
