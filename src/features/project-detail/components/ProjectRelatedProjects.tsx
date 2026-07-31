import { Link } from "@tanstack/react-router";
import { ArrowRight, MapPin } from "lucide-react";

import { Section } from "@/components/layout/Section";

import type { DecisionDeckRelatedProject, DecisionDeckValue } from "../decision-deck-model";

export interface ProjectRelatedProjectsProps {
  related: DecisionDeckValue<readonly DecisionDeckRelatedProject[]>;
}

/**
 * A plain navigation list, preserving the model's deterministic order. It is
 * deliberately not framed as a match, shortlist or personalized endorsement.
 */
export function ProjectRelatedProjects({ related }: ProjectRelatedProjectsProps) {
  const projects =
    related.state === "supported"
      ? related.value.filter((project) => project.slug.trim() && project.name.trim())
      : [];
  if (projects.length === 0) return null;

  return (
    <Section
      id="related"
      eyebrow="Explore"
      title="Related projects"
      className="py-11 sm:py-16"
      data-decision-deck-section=""
      data-testid="related-projects"
    >
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => {
          const slug = project.slug.trim();
          const name = project.name.trim();
          const location = project.location.trim();
          return (
            <li key={slug} data-project-slug={slug}>
              <Link
                to="/projects/$slug"
                params={{ slug }}
                className="group flex h-full items-center justify-between gap-4 rounded-xl border border-border/60 bg-card p-5 transition hover:border-border hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label={`Open ${name}`}
              >
                <span className="min-w-0">
                  <span className="block font-serif text-xl leading-tight text-foreground">
                    {name}
                  </span>
                  {location ? (
                    <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{location}</span>
                    </span>
                  ) : null}
                </span>
                <ArrowRight
                  className="h-4 w-4 shrink-0 text-accent transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
