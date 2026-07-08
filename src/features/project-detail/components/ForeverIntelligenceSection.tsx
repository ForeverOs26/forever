import {
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  BriefcaseBusiness,
  Clock,
  DoorOpen,
  FileText,
  Lightbulb,
  ShieldCheck,
  Target,
} from "lucide-react";
import { useMemo } from "react";

import { generateForeverIntelligenceReport } from "@/features/intelligence/intelligence-engine";
import type {
  ForeverIntelligenceReport,
  IntelligenceRecommendation,
  ScoreResult,
} from "@/features/intelligence/intelligence-types";

import type { ProjectDetail } from "../project-detail-types";

type ForeverIntelligenceSectionProps = {
  project: ProjectDetail;
};

type Confidence = {
  label: "Low" | "Medium" | "High";
  percentage: number;
  evidenceCount: number;
  evidenceTotal: number;
};

const scoreGroups = ["trust", "investment", "rental", "location", "liquidity", "constructionRisk"] as const;

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

function getConfidence(report: ForeverIntelligenceReport): Confidence {
  const evidenceCount = scoreGroups.filter((key) =>
    Object.values(report.scores[key].sourceValues).some(hasMeaningfulValue)
  ).length;
  const percentage = Math.round((evidenceCount / scoreGroups.length) * 100);

  if (percentage >= 75) {
    return { label: "High", percentage, evidenceCount, evidenceTotal: scoreGroups.length };
  }

  if (percentage >= 45) {
    return { label: "Medium", percentage, evidenceCount, evidenceTotal: scoreGroups.length };
  }

  return { label: "Low", percentage, evidenceCount, evidenceTotal: scoreGroups.length };
}

function getTopItems(items: IntelligenceRecommendation[], count: number): IntelligenceRecommendation[] {
  return items.filter((item) => item.title || item.summary).slice(0, count);
}

function getRecommendationLabel(score: number): string {
  if (score >= 80) {
    return "Strong recommendation";
  }

  if (score >= 65) {
    return "Recommended";
  }

  if (score >= 50) {
    return "Selective fit";
  }

  return "Needs further review";
}

function getWhyRecommendation(report: ForeverIntelligenceReport): string {
  const topStrength = getTopItems(report.strengths, 1)[0];

  if (topStrength?.summary) {
    return topStrength.summary;
  }

  return report.bestBuyerProfile.summary;
}

function EvidenceList({
  items,
  tone = "positive",
}: {
  items: IntelligenceRecommendation[];
  tone?: "positive" | "risk";
}) {
  const visibleItems = getTopItems(items, 4);

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {visibleItems.map((item) => (
        <div
          key={`${item.title}-${item.summary}`}
          className={`rounded-lg border p-4 ${
            tone === "risk"
              ? "border-amber-500/25 bg-amber-500/5"
              : "border-border bg-background"
          }`}
        >
          <p className="font-semibold text-foreground">{item.title}</p>
          {item.summary ? <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.summary}</p> : null}
        </div>
      ))}
    </div>
  );
}

function ScoreEvidenceRow({ score }: { score: ScoreResult }) {
  return (
    <div className="border-b border-border/70 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-foreground">{score.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{score.summary}</p>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-muted/40 px-3 py-1 text-sm font-semibold text-foreground">
          {score.score}
        </span>
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
        aria-label={`${score.label} score ${score.score} out of ${score.maxScore}`}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${score.score}%` }} />
      </div>
    </div>
  );
}

function RecommendationDetail({
  icon: Icon,
  title,
  recommendation,
}: {
  icon: typeof Target;
  title: string;
  recommendation: IntelligenceRecommendation;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      </div>
      <p className="text-sm font-semibold text-foreground">{recommendation.title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{recommendation.summary}</p>
    </div>
  );
}

export function ForeverIntelligenceSection({ project }: ForeverIntelligenceSectionProps) {
  const report = useMemo(() => generateForeverIntelligenceReport(project), [project]);
  const confidence = useMemo(() => getConfidence(report), [report]);
  const recommendation = getRecommendationLabel(report.totalScore);
  const strengths = getTopItems(report.strengths, 4);
  const risks = getTopItems(report.risks, 4);
  const whyRecommendation = getWhyRecommendation(report);
  const scoreResults = [
    report.scores.trust,
    report.scores.investment,
    report.scores.rental,
    report.scores.location,
    report.scores.liquidity,
    report.scores.constructionRisk,
  ];

  return (
    <section className="bg-background py-16">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-lg border border-border bg-muted/10 p-5 md:p-8">
            <div className="mb-8 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                <FileText className="h-4 w-4" />
                Forever Intelligence
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Analyst-style assessment
              </span>
            </div>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Forever Recommendation
                </p>
                <h2 className="mt-3 max-w-3xl text-4xl font-bold leading-tight text-foreground md:text-5xl">
                  {recommendation}
                </h2>
                <p className="mt-4 max-w-3xl text-xl leading-8 text-muted-foreground">
                  {report.verdict}
                </p>
              </div>

              <div className="rounded-lg border border-primary/30 bg-background p-6 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
                  <BarChart3 className="h-6 w-6 text-primary" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Forever Score
                </p>
                <p className="mt-3 font-serif text-7xl leading-none text-foreground">{report.totalScore}</p>
                <p className="mt-2 text-sm font-medium text-muted-foreground">out of 100</p>
              </div>
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="space-y-6">
                <div className="rounded-lg border border-border bg-background p-5 md:p-6">
                  <div className="mb-3 flex items-center gap-2">
                    <Target className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold text-foreground">Confidence</h3>
                  </div>
                  <p className="text-3xl font-bold text-foreground">{confidence.label}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {confidence.percentage}% data coverage across {confidence.evidenceCount}/{confidence.evidenceTotal} scoring groups.
                  </p>
                </div>

                <RecommendationDetail
                  icon={BriefcaseBusiness}
                  title="Best Buyer Profile"
                  recommendation={report.bestBuyerProfile}
                />
                <RecommendationDetail
                  icon={Clock}
                  title="Investment Horizon"
                  recommendation={report.investmentHorizon}
                />
                <RecommendationDetail
                  icon={DoorOpen}
                  title="Exit Strategy"
                  recommendation={report.exitStrategy}
                />
              </div>

              <div className="space-y-6">
                <div className="rounded-lg border border-border bg-background p-5 md:p-6">
                  <div className="mb-3 flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-primary" />
                    <h3 className="text-xl font-semibold text-foreground">Why Forever recommends this project</h3>
                  </div>
                  <p className="text-base leading-8 text-muted-foreground">{whyRecommendation}</p>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  {strengths.length > 0 ? (
                    <div className="rounded-lg border border-border bg-background p-5 md:p-6">
                      <div className="mb-4 flex items-center gap-2">
                        <BadgeCheck className="h-5 w-5 text-primary" />
                        <h3 className="text-xl font-semibold text-foreground">Key Strengths</h3>
                      </div>
                      <EvidenceList items={strengths} />
                    </div>
                  ) : null}

                  {risks.length > 0 ? (
                    <div className="rounded-lg border border-border bg-background p-5 md:p-6">
                      <div className="mb-4 flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-primary" />
                        <h3 className="text-xl font-semibold text-foreground">Material Risks</h3>
                      </div>
                      <EvidenceList items={risks} tone="risk" />
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg border border-border bg-background p-5 md:p-6">
                  <div className="mb-2 flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    <h3 className="text-xl font-semibold text-foreground">Evidence Scores</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    These category scores provide the evidence base behind the recommendation.
                  </p>
                  <div className="mt-2">
                    {scoreResults.map((score) => (
                      <ScoreEvidenceRow key={score.key} score={score} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
