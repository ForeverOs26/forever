import {
  AlertTriangle,
  BadgeCheck,
  CalendarCheck,
  ClipboardCheck,
  FileBadge,
  ShieldCheck,
  Stamp,
  Target,
} from "lucide-react";
import { useMemo } from "react";

import { generateForeverIntelligenceReport } from "@/features/intelligence/intelligence-engine";
import type { ProjectDetail } from "@/features/project-detail/project-detail-types";
import { createForeverPassport } from "@/features/passport";
import type { ForeverPassport, PassportScore, PassportSection } from "@/features/passport";

type ForeverPassportCardProps = {
  project: ProjectDetail;
};

function formatPassportValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Not recorded";
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "Not recorded";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value);
}

function ScoreEvidenceRow({ score }: { score: PassportScore }) {
  return (
    <div className="border-b border-border/70 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
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
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${score.score}%` }}
        />
      </div>
    </div>
  );
}

function SummaryBlock({
  title,
  section,
  tone = "neutral",
}: {
  title: string;
  section: PassportSection;
  tone?: "neutral" | "risk";
}) {
  const visibleItems = section.items.filter((item) => item.value !== null && item.value !== undefined && item.value !== "");
  const Icon = tone === "risk" ? AlertTriangle : ClipboardCheck;

  return (
    <div className="rounded-lg border border-border bg-background p-5 md:p-6">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {section.summary}
      </p>
      {visibleItems.length > 0 ? (
        <div className="mt-4 space-y-3">
          {visibleItems.map((item) => (
            <div
              key={`${item.label}-${formatPassportValue(item.value)}`}
              className={`rounded border p-3 ${
                tone === "risk"
                  ? "border-amber-500/25 bg-amber-500/5"
                  : "border-border/80 bg-muted/30"
              }`}
            >
              <p className="text-sm font-medium text-foreground">{item.label}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {formatPassportValue(item.value)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function VerificationRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-border/70 py-3 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
      <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{formatPassportValue(value)}</span>
    </div>
  );
}

function PassportHeader({ passport }: { passport: ForeverPassport }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <FileBadge className="h-4 w-4" />
            Forever Passport
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <BadgeCheck className="h-4 w-4 text-primary" />
            Certificate v{passport.metadata.passportVersion}
          </span>
        </div>

        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {passport.foreverId}
        </p>
        <h2 className="mt-3 max-w-3xl text-3xl font-bold leading-tight text-foreground md:text-5xl">
          {passport.projectName}
        </h2>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
          {passport.verdict}
        </p>
      </div>

      <div className="rounded-lg border border-primary/30 bg-background p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
          <Stamp className="h-6 w-6 text-primary" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Forever Score
        </p>
        <p className="mt-3 font-serif text-7xl leading-none text-foreground">
          {passport.overallScore}
        </p>
        <p className="mt-2 text-sm font-medium text-muted-foreground">out of 100</p>
        <div className="mt-5 rounded border border-border bg-muted/30 px-4 py-3">
          <p className="text-sm font-semibold text-foreground">{passport.verdict}</p>
        </div>
      </div>
    </div>
  );
}

export function ForeverPassportCard({ project }: ForeverPassportCardProps) {
  const passport = useMemo(() => {
    const report = generateForeverIntelligenceReport(project);
    return createForeverPassport(project, report);
  }, [project]);

  return (
    <section className="bg-muted/20 py-16">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-6xl rounded-lg border border-border bg-background p-5 shadow-sm md:p-8">
          <div className="rounded-lg border border-border/80 bg-muted/10 p-5 md:p-8">
          <PassportHeader passport={passport} />

            <div className="mt-8 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="space-y-6">
                <div className="rounded-lg border border-border bg-background p-5 md:p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <Target className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold text-foreground">Best Buyer Profile</h3>
                  </div>
                  <p className="text-base font-semibold text-foreground">{passport.bestBuyerProfile.label}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {formatPassportValue(passport.bestBuyerProfile.value)}
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-background p-5 md:p-6">
                  <div className="mb-2 flex items-center gap-2">
                    <CalendarCheck className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold text-foreground">Verification</h3>
                  </div>
                  <p className="mb-2 text-sm text-muted-foreground">
                    Data freshness and review markers for this passport.
                  </p>
                  <VerificationRow label="Forever Inspection" value={passport.lastInspection} />
                  <VerificationRow label="Last Price Update" value={passport.lastPriceUpdate} />
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background p-5 md:p-6">
                <div className="mb-2 flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">Evidence Scores</h3>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Category scores support the overall certificate quality rating.
                </p>
                <div className="mt-2">
                  <ScoreEvidenceRow score={passport.trust} />
                  <ScoreEvidenceRow score={passport.investment} />
                  <ScoreEvidenceRow score={passport.rental} />
                  <ScoreEvidenceRow score={passport.liquidity} />
                  <ScoreEvidenceRow score={passport.construction} />
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <SummaryBlock title="Forever Recommendation" section={passport.recommendationSummary} />
              <SummaryBlock title="Risks Summary" section={passport.risksSummary} tone="risk" />
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Canonical project summary
              </span>
              <span className="inline-flex items-center gap-2">
                <BadgeCheck className="h-4 w-4 text-primary" />
                Generated {formatPassportValue(passport.metadata.generatedAt)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
