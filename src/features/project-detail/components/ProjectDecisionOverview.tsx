import { Section } from "@/components/layout/Section";

import type {
  DecisionDeckInventorySummary,
  DecisionDeckOverview,
  DecisionDeckValue,
} from "../decision-deck-model";

function supported<T>(
  value: DecisionDeckValue<T>,
): value is Extract<DecisionDeckValue<T>, { state: "supported" }> {
  return value.state === "supported";
}

export interface ProjectDecisionOverviewProps {
  overview: DecisionDeckValue<DecisionDeckOverview>;
}

export function ProjectDecisionOverview({ overview }: ProjectDecisionOverviewProps) {
  if (!supported(overview)) return null;

  const inventory = (value: DecisionDeckInventorySummary) =>
    `${value.availableCount} available · ${value.listedCount} listed`;
  const facts = [
    supported(overview.value.projectType)
      ? ["Property type", overview.value.projectType.value]
      : null,
    supported(overview.value.constructionContext)
      ? ["Construction", overview.value.constructionContext.value]
      : null,
    supported(overview.value.location) ? ["Location", overview.value.location.value] : null,
    supported(overview.value.address) ? ["Address", overview.value.address.value] : null,
    supported(overview.value.listedInventory)
      ? ["Recorded inventory", inventory(overview.value.listedInventory.value)]
      : null,
  ].filter((fact): fact is [string, string] => fact !== null);

  return (
    <Section
      id="overview"
      eyebrow="Overview"
      title="Recorded project facts"
      description="A concise reading of the canonical public record. Unsupported claims are omitted."
      className="py-11 sm:py-16"
      data-decision-deck-section
      data-testid="project-overview"
    >
      <dl className="grid gap-x-10 gap-y-3 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-3"
          >
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="max-w-[65%] text-right text-sm font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
