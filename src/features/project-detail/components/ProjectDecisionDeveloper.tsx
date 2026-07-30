import { ExternalLink, ShieldCheck } from "lucide-react";

import { Section } from "@/components/layout/Section";

import type { DecisionDeckDeveloper, DecisionDeckValue } from "../decision-deck-model";

function supported<T>(
  value: DecisionDeckValue<T>,
): value is Extract<DecisionDeckValue<T>, { state: "supported" }> {
  return value.state === "supported";
}

export interface ProjectDecisionDeveloperProps {
  developer: DecisionDeckValue<DecisionDeckDeveloper>;
}

export function ProjectDecisionDeveloper({ developer }: ProjectDecisionDeveloperProps) {
  if (!supported(developer)) return null;
  const identity = developer.value;

  return (
    <Section
      id="developer"
      eyebrow="Developer"
      title={identity.name}
      className="py-11 sm:py-16"
      data-decision-deck-section
      data-testid="project-developer"
    >
      <div className="max-w-3xl rounded-[18px] border border-border/70 bg-card p-5 sm:p-7">
        <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
          {identity.verified ? "Canonical linked identity" : "Unverified recorded name"}
        </p>
        {identity.description ? (
          <p className="mt-4 whitespace-pre-line text-sm leading-7 text-muted-foreground">
            {identity.description}
          </p>
        ) : null}
        {identity.website ? (
          <a
            href={identity.website}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Developer website <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </Section>
  );
}
