import type { ProjectDetail } from "@/features/project-detail/project-detail-types";

import type { AdvisoryRisk, AdvisorySession } from "./types";

function createDataRisks(project: ProjectDetail): AdvisoryRisk[] {
  const risks: AdvisoryRisk[] = [];

  if (!project.pricing.startingPriceTHB && !project.pricing.priceRange) {
    risks.push({
      id: `${project.core.slug}-pricing-unavailable`,
      title: "Pricing unavailable",
      explanation: "The existing project record does not contain a starting price or price range.",
      severity: "attention",
      scope: "data",
    });
  }

  if (!project.core.constructionStatus) {
    risks.push({
      id: `${project.core.slug}-construction-status-unavailable`,
      title: "Construction status unavailable",
      explanation: "The existing project record does not contain a construction status.",
      severity: "attention",
      scope: "data",
    });
  }

  if (!project.developer) {
    risks.push({
      id: `${project.core.slug}-developer-unavailable`,
      title: "Developer unavailable",
      explanation: "The existing project record does not contain a linked developer.",
      severity: "attention",
      scope: "data",
    });
  }

  return risks;
}

/** Maps the existing Forever project view model into the Advisory UI contract. */
export function mapProjectToAdvisorySession(project: ProjectDetail): AdvisorySession {
  const primaryReason = project.trust.trustNote || project.trust.verdict || null;

  return {
    client: {
      clientName: null,
      buyerType: null,
      primaryGoal: null,
      budget: null,
      timeline: null,
      riskProfile: null,
      topPriorities: [],
    },
    recommendations: [
      {
        id: project.core.slug,
        name: project.core.name,
        matchScore: null,
        primaryReason,
        tradeOff: project.core.constructionStatus
          ? `Construction status: ${project.core.constructionStatus}`
          : null,
        confidence: null,
      },
    ],
    strategy: {
      discussFirst: primaryReason,
      avoidLeadingWith: null,
      showFirstProjectId: project.core.slug,
      mustClarify: null,
      consultationSequence: [],
    },
    risks: createDataRisks(project),
  };
}
