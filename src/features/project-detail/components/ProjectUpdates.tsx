import { CalendarClock } from "lucide-react";

import { Section } from "@/components/layout/Section";

import type { DecisionDeckUpdate, DecisionDeckValue } from "../decision-deck-model";

export interface ProjectUpdatesProps {
  updates: DecisionDeckValue<readonly DecisionDeckUpdate[]>;
}

/** Only model-supported, structured update kinds are rendered. */
export function ProjectUpdates({ updates }: ProjectUpdatesProps) {
  if (updates.state !== "supported" || updates.value.length === 0) return null;

  return (
    <Section
      id="updates"
      eyebrow="Record"
      title="Project updates"
      className="py-11 sm:py-16"
      data-decision-deck-section=""
      data-testid="project-updates"
    >
      <ol className="overflow-hidden rounded-xl border border-border/60 bg-card">
        {updates.value.map((update, index) => (
          <li
            key={`${update.type}-${update.date}-${index}`}
            className="flex items-start gap-3 border-b border-border/60 px-4 py-4 last:border-b-0 sm:px-5"
          >
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">Price list updated</span>
              <time
                dateTime={update.date}
                className="mt-1 block text-xs tabular-nums text-muted-foreground"
              >
                {update.date}
              </time>
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}
