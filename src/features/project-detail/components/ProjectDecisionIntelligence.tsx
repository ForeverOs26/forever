import { CircleAlert, ShieldCheck } from "lucide-react";

import { Section } from "@/components/layout/Section";

import type { DecisionDeckIntelligenceEvidence, DecisionDeckValue } from "../decision-deck-model";

function supported<T>(
  value: DecisionDeckValue<T>,
): value is Extract<DecisionDeckValue<T>, { state: "supported" }> {
  return value.state === "supported";
}

export interface ProjectDecisionIntelligenceProps {
  intelligence: DecisionDeckValue<DecisionDeckIntelligenceEvidence>;
}

export function ProjectDecisionIntelligence({ intelligence }: ProjectDecisionIntelligenceProps) {
  if (!supported(intelligence)) return null;

  const record = intelligence.value;
  const facts = [
    supported(record.verdict) ? ["Verdict", record.verdict.value] : null,
    supported(record.marketPosition) ? ["Market position", record.marketPosition.value] : null,
    supported(record.rentalYield) ? ["Recorded rental yield", record.rentalYield.value] : null,
    supported(record.rentalDemand) ? ["Recorded rental demand", record.rentalDemand.value] : null,
    supported(record.capitalGrowthEstimate)
      ? ["Recorded growth estimate", record.capitalGrowthEstimate.value]
      : null,
    supported(record.buyerProfile) ? ["Suitable buyer profile", record.buyerProfile.value] : null,
    supported(record.rentalStrategy) ? ["Rental strategy", record.rentalStrategy.value] : null,
    supported(record.exitConsiderations)
      ? ["Exit considerations", record.exitConsiderations.value]
      : null,
    supported(record.decisionHorizon) ? ["Decision horizon", record.decisionHorizon.value] : null,
  ].filter((fact): fact is [string, string] => fact !== null);

  const evidenceLists = [
    supported(record.risks) ? ["Material risks", record.risks.value, CircleAlert] : null,
    supported(record.weaknesses) ? ["Weaknesses", record.weaknesses.value, CircleAlert] : null,
    supported(record.strengths)
      ? ["Verified strengths", record.strengths.value, ShieldCheck]
      : null,
  ].filter((group): group is [string, readonly string[], typeof CircleAlert] => group !== null);

  return (
    <Section
      id="intelligence"
      eyebrow="Forever Intelligence"
      title="Supported decision evidence"
      description="Only directly published evidence appears here; the page does not synthesize a score or buyer advice."
      className="bg-primary py-11 text-primary-foreground sm:py-16"
      data-decision-deck-section
      data-testid="project-intelligence"
    >
      {facts.length > 0 ? (
        <dl className="grid gap-3 md:grid-cols-2">
          {facts.map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-primary-foreground/20 bg-primary-foreground/[0.04] p-4"
            >
              <dt className="text-xs uppercase tracking-[0.14em] text-primary-foreground/65">
                {label}
              </dt>
              <dd className="mt-2 text-sm leading-6 text-primary-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {evidenceLists.length > 0 ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {evidenceLists.map(([label, values, Icon]) => (
            <div key={label} className="rounded-xl border border-primary-foreground/20 p-4">
              <h3 className="inline-flex items-center gap-2 text-sm font-medium">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </h3>
              <ul className="mt-3 space-y-2 text-sm text-primary-foreground/75">
                {values.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  );
}
