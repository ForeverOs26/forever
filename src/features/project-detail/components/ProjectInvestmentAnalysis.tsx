import { Droplets, LineChart, TrendingUp, Users } from "lucide-react";
import { Section } from "@/components/layout/Section";
import type { ProjectDetail } from "../project-detail-types";

type InvestmentMetric = {
  icon: typeof TrendingUp;
  label: string;
  value: string;
};

type ProjectInvestmentAnalysisProps = {
  project: ProjectDetail;
};

export function ProjectInvestmentAnalysis({ project }: ProjectInvestmentAnalysisProps) {
  const metrics: InvestmentMetric[] = [
    project.investment.rentalYield && {
      icon: TrendingUp,
      label: "Rental Yield",
      value: project.investment.rentalYield,
    },
    project.investment.capitalGrowthEstimate && {
      icon: LineChart,
      label: "Capital Appreciation",
      value: project.investment.capitalGrowthEstimate,
    },
    project.investment.rentalDemand && {
      icon: Users,
      label: "Demand",
      value: project.investment.rentalDemand,
    },
    project.investment.rentalDemand && {
      icon: Droplets,
      label: "Liquidity",
      value: liquidityFor(project.investment.rentalDemand),
    },
  ].filter((metric): metric is InvestmentMetric => Boolean(metric));

  if (metrics.length === 0) return null;

  return (
    <Section eyebrow="Investment Snapshot" title="At a glance" className="pt-0">
      <div className="grid grid-cols-2 gap-4 rounded-3xl border border-border/60 bg-card p-6 sm:p-8 md:grid-cols-4">
        {metrics.map((metric) => (
          <MetricTile
            key={metric.label}
            icon={metric.icon}
            label={metric.label}
            value={metric.value}
          />
        ))}
      </div>
    </Section>
  );
}

function liquidityFor(rentalDemand: string): string {
  if (rentalDemand === "Very High") return "High";
  if (rentalDemand === "High") return "Moderate - High";
  if (rentalDemand === "Moderate") return "Moderate";
  return "Limited";
}

function MetricTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Icon className="h-5 w-5 text-accent" />
      <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      <div className="font-serif text-lg leading-snug text-foreground">{value}</div>
    </div>
  );
}
