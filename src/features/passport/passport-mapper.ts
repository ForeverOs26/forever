import type {
  ForeverIntelligenceReport,
  IntelligenceEvidence,
  IntelligenceRecommendation,
  ScoreResult,
} from "@/features/intelligence/intelligence-types";
import type { ProjectDetail } from "@/features/project-detail/project-detail-types";

import type {
  ForeverPassport,
  PassportMetadata,
  PassportScore,
  PassportSection,
  PassportSectionItem,
  PassportTimeline,
  PassportTimelineEvent,
  PassportVerificationDates,
} from "./passport-types";

type CreateForeverPassportOptions = {
  generatedAt?: string;
};

const supportedRenderTargets: PassportMetadata["supportedRenderTargets"] = [
  "website",
  "tablet-mode",
  "crm",
  "pdf",
  "investor-report",
  "mobile-app",
];

function compact<T>(items: Array<T | null | undefined>): T[] {
  return items.filter((item): item is T => item !== null && item !== undefined);
}

function getForeverId(project: ProjectDetail): string {
  return `FOREVER-${project.core.slug.toUpperCase()}`;
}

function toScore(score: ScoreResult): PassportScore {
  return {
    label: score.label,
    score: score.score,
    maxScore: score.maxScore,
    band: score.band,
    summary: score.summary,
    sourceFields: score.sourceFields,
    sourceValues: score.sourceValues,
  };
}

function toSectionItem(item: IntelligenceRecommendation): PassportSectionItem {
  return {
    label: item.title,
    value: item.summary,
    note: item.severity ? `Severity: ${item.severity}` : undefined,
    sourceFields: item.sourceFields,
    sourceValues: item.sourceValues,
  };
}

function createSection(
  section: Omit<PassportSection, keyof IntelligenceEvidence | "items"> & {
    items: PassportSectionItem[];
    evidence?: IntelligenceEvidence;
  },
): PassportSection {
  return {
    key: section.key,
    title: section.title,
    summary: section.summary,
    items: section.items,
    sourceFields:
      section.evidence?.sourceFields ?? section.items.flatMap((item) => item.sourceFields),
    sourceValues:
      section.evidence?.sourceValues ??
      Object.assign({}, ...section.items.map((item) => item.sourceValues)),
  };
}

function createRecommendationSummary(report: ForeverIntelligenceReport): PassportSection {
  const items = compact([
    toSectionItem(report.bestBuyerProfile),
    toSectionItem(report.rentalStrategy),
    toSectionItem(report.exitStrategy),
    toSectionItem(report.investmentHorizon),
  ]);

  return createSection({
    key: "recommendation",
    title: "Recommendation Summary",
    summary: report.verdict,
    items,
    evidence: {
      sourceFields: ["intelligence.verdict", "intelligence.totalScore"],
      sourceValues: {
        verdict: report.verdict,
        totalScore: report.totalScore,
      },
    },
  });
}

function createRisksSummary(report: ForeverIntelligenceReport): PassportSection {
  const riskItems = report.risks.map(toSectionItem);

  return createSection({
    key: "risks",
    title: "Risks Summary",
    summary:
      riskItems.length > 0
        ? riskItems.map((item) => String(item.value)).join(" ")
        : "No major structured risks identified from available project data.",
    items: riskItems,
  });
}

function createVerificationDates(project: ProjectDetail): PassportVerificationDates {
  return {
    lastInspection: project.trust.lastInspection,
    lastPriceUpdate: project.pricing.lastPriceUpdate,
  };
}

function createTimeline(project: ProjectDetail, generatedAt: string): PassportTimeline {
  const events: PassportTimelineEvent[] = [];

  if (project.trust.foreverVerified) {
    events.push({
      type: "verified",
      label: "Forever verified",
      date: project.trust.lastInspection,
      sourceFields: ["trust.foreverVerified", "trust.lastInspection"],
      sourceValues: {
        foreverVerified: project.trust.foreverVerified,
        lastInspection: project.trust.lastInspection,
      },
    });
  }

  if (project.trust.lastInspection) {
    events.push({
      type: "inspection",
      label: "Last inspection",
      date: project.trust.lastInspection,
      sourceFields: ["trust.lastInspection"],
      sourceValues: {
        lastInspection: project.trust.lastInspection,
      },
    });
  }

  if (project.pricing.lastPriceUpdate) {
    events.push({
      type: "price-update",
      label: "Last price update",
      date: project.pricing.lastPriceUpdate,
      sourceFields: ["pricing.lastPriceUpdate"],
      sourceValues: {
        lastPriceUpdate: project.pricing.lastPriceUpdate,
      },
    });
  }

  if (generatedAt) {
    events.push({
      type: "passport-generated",
      label: "Passport generated",
      date: generatedAt,
      sourceFields: ["passport.metadata.generatedAt"],
      sourceValues: {
        generatedAt,
      },
    });
  }

  return { events };
}

function createSections(
  project: ProjectDetail,
  report: ForeverIntelligenceReport,
  verificationDates: PassportVerificationDates,
): PassportSection[] {
  const identity = createSection({
    key: "identity",
    title: "Project Identity",
    summary: project.core.name,
    items: [
      {
        label: "Forever ID",
        value: getForeverId(project),
        sourceFields: ["core.slug"],
        sourceValues: { slug: project.core.slug },
      },
      {
        label: "Project Name",
        value: project.core.name,
        sourceFields: ["core.name"],
        sourceValues: { name: project.core.name },
      },
    ],
  });

  const verdict = createSection({
    key: "verdict",
    title: "Forever Verdict",
    summary: report.verdict,
    items: [
      {
        label: "Overall Score",
        value: report.totalScore,
        sourceFields: ["intelligence.totalScore"],
        sourceValues: { totalScore: report.totalScore },
      },
      {
        label: "Verdict",
        value: report.verdict,
        sourceFields: ["intelligence.verdict"],
        sourceValues: { verdict: report.verdict },
      },
    ],
  });

  const scores = createSection({
    key: "scores",
    title: "Core Scores",
    summary: "Structured project scores generated by the Forever Intelligence Engine.",
    items: [
      report.scores.trust,
      report.scores.investment,
      report.scores.rental,
      report.scores.liquidity,
      report.scores.constructionRisk,
    ].map((score) => ({
      label: score.label,
      value: score.score,
      note: score.summary,
      sourceFields: score.sourceFields,
      sourceValues: score.sourceValues,
    })),
  });

  const buyerFit = createSection({
    key: "buyer-fit",
    title: "Best Buyer Profile",
    summary: report.bestBuyerProfile.summary,
    items: [toSectionItem(report.bestBuyerProfile)],
  });

  const verification = createSection({
    key: "verification",
    title: "Verification Dates",
    summary: "Latest structured verification dates available for this project.",
    items: [
      {
        label: "Last Inspection",
        value: verificationDates.lastInspection,
        sourceFields: ["trust.lastInspection"],
        sourceValues: { lastInspection: verificationDates.lastInspection },
      },
      {
        label: "Last Price Update",
        value: verificationDates.lastPriceUpdate,
        sourceFields: ["pricing.lastPriceUpdate"],
        sourceValues: { lastPriceUpdate: verificationDates.lastPriceUpdate },
      },
    ],
  });

  return [
    identity,
    verdict,
    scores,
    buyerFit,
    createRecommendationSummary(report),
    createRisksSummary(report),
    verification,
  ];
}

export function createForeverPassport(
  project: ProjectDetail,
  report: ForeverIntelligenceReport,
  options: CreateForeverPassportOptions = {},
): ForeverPassport {
  // A generation timestamp is caller-owned metadata. Never invent one during
  // render: that is unstable across SSR/hydration and can imply freshness that
  // the project evidence does not support.
  const generatedAt = options.generatedAt?.trim() ?? "";
  const verificationDates = createVerificationDates(project);
  const recommendationSummary = createRecommendationSummary(report);
  const risksSummary = createRisksSummary(report);

  return {
    foreverId: getForeverId(project),
    projectName: project.core.name,
    projectSlug: project.core.slug,
    overallScore: report.totalScore,
    verdict: report.verdict,
    trust: toScore(report.scores.trust),
    investment: toScore(report.scores.investment),
    rental: toScore(report.scores.rental),
    liquidity: toScore(report.scores.liquidity),
    construction: toScore(report.scores.constructionRisk),
    bestBuyerProfile: toSectionItem(report.bestBuyerProfile),
    recommendationSummary,
    risksSummary,
    verificationDates,
    lastInspection: verificationDates.lastInspection,
    lastPriceUpdate: verificationDates.lastPriceUpdate,
    sections: createSections(project, report, verificationDates),
    timeline: createTimeline(project, generatedAt),
    metadata: {
      schemaVersion: "1.0",
      passportVersion: "1.0",
      generatedAt,
      source: "project-detail-and-intelligence-report",
      sourceProjectSlug: project.core.slug,
      supportedRenderTargets,
    },
  };
}
