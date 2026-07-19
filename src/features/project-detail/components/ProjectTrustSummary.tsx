import { BadgeCheck, CalendarCheck, HardHat, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Section } from "@/components/layout/Section";
import type { ProjectDetail } from "../project-detail-types";

type ProjectTrustSummaryProps = {
  project: ProjectDetail;
};

export function ProjectTrustSummary({ project }: ProjectTrustSummaryProps) {
  const stats = [
    project.trust.trustScore > 0 && (
      <SummaryStat
        key="trust"
        label="Forever Score"
        value={project.trust.trustScore.toFixed(1)}
        suffix="/ 10"
      />
    ),
    project.investment.investmentValue > 0 && (
      <SummaryStat
        key="investment"
        label="Investment Score"
        value={project.investment.investmentValue.toFixed(1)}
        suffix="/ 10"
      />
    ),
    project.trust.marketPosition && (
      <SummaryStat key="market" label="Market Position" value={project.trust.marketPosition} />
    ),
    project.trust.verdict && (
      <SummaryStat key="verdict" label="Forever Verdict" value={project.trust.verdict} accent />
    ),
  ].filter(Boolean);
  const cols =
    stats.length === 4
      ? "sm:grid-cols-4"
      : stats.length === 3
        ? "sm:grid-cols-3"
        : "sm:grid-cols-2";
  const priceVerified =
    project.pricing.verifiedPrice.toLowerCase() === "verified" || project.trust.foreverVerified;
  const hasInspection =
    project.trust.lastInspection ||
    project.core.constructionStatus ||
    project.pricing.promotion ||
    project.pricing.verifiedPrice;

  if (stats.length === 0 && !hasInspection) return null;

  return (
    <>
      {stats.length > 0 && (
        <Section
          eyebrow="Forever Advisory Summary"
          title="Trust, value, position and verdict"
          className="py-16 sm:py-20"
        >
          <div className="rounded-3xl border border-border/60 bg-card p-6 sm:p-8">
            <div className={`grid grid-cols-1 gap-8 ${cols} sm:gap-6`}>{stats}</div>
          </div>
        </Section>
      )}

      {hasInspection && (
        <Section
          eyebrow={project.trust.foreverVerified ? "Forever Inspection" : "Project record"}
          title={
            project.trust.foreverVerified ? "What we verified on site" : "Available project facts"
          }
          className="pt-0"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {project.trust.lastInspection && (
              <InspectionItem
                icon={CalendarCheck}
                label="Forever Inspection"
                value={project.trust.lastInspection}
              />
            )}
            {project.core.constructionStatus && (
              <InspectionItem
                icon={HardHat}
                label="Construction status"
                value={project.core.constructionStatus}
              />
            )}
            {project.pricing.promotion && (
              <InspectionItem
                icon={Sparkles}
                label="Verified Offer"
                value={project.pricing.promotion}
              />
            )}
            {project.pricing.verifiedPrice && (
              <InspectionItem
                icon={BadgeCheck}
                label="Forever Verified Price"
                valueNode={
                  <div className="mt-1 flex flex-col gap-1.5">
                    {priceVerified ? (
                      <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/25 bg-accent/[0.08] px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">
                        <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2} />
                        Forever Verified Price
                      </span>
                    ) : (
                      <span className="text-sm text-foreground">
                        {project.pricing.verifiedPrice}
                      </span>
                    )}
                    {project.pricing.lastPriceUpdate && (
                      <span className="text-xs text-muted-foreground">
                        Updated {project.pricing.lastPriceUpdate}
                      </span>
                    )}
                  </div>
                }
              />
            )}
          </div>
        </Section>
      )}
    </>
  );
}

function SummaryStat({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
      <span
        className={
          accent
            ? "font-serif text-2xl leading-tight tracking-tight text-foreground"
            : "font-serif text-3xl tracking-tight text-foreground"
        }
      >
        {value}
        {suffix && (
          <span className="ml-1 font-sans text-sm font-normal text-muted-foreground">{suffix}</span>
        )}
      </span>
      <span className="mt-0.5 h-[2px] w-8 rounded-full bg-accent/30" />
    </div>
  );
}

function InspectionItem({
  icon: Icon,
  label,
  value,
  valueNode,
}: {
  icon: typeof CalendarCheck;
  label: string;
  value?: string;
  valueNode?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-5">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
      <div>
        <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </div>
        {valueNode ?? <div className="mt-1 text-sm text-foreground">{value}</div>}
      </div>
    </div>
  );
}
