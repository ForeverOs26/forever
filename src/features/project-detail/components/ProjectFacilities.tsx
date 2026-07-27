import { Check } from "lucide-react";

import { Section } from "@/components/layout/Section";

import type { ProjectDetail } from "../project-detail-types";
import { hasFacilitiesSection, projectFacilities } from "../project-sections";

/**
 * Facilities (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * Only the facilities the project record states. Nothing is inferred from a
 * photograph: a render that happens to show water is not evidence of a
 * communal pool, and a project with no recorded facilities shows no section
 * rather than a plausible-looking list.
 */

export interface ProjectFacilitiesProps {
  project: ProjectDetail;
}

export function ProjectFacilities({ project }: ProjectFacilitiesProps) {
  const facilities = projectFacilities(project);
  if (!hasFacilitiesSection(project)) return null;

  return (
    <Section
      id="facilities"
      eyebrow="Facilities"
      title="What the project includes"
      className="pt-0"
      data-testid="project-facilities"
    >
      <ul className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {facilities.map((facility) => (
          <li key={facility} className="flex items-start gap-3 border-b border-border/50 pb-3">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <span className="text-sm text-foreground">{facility}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
