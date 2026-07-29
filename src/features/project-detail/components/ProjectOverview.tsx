import { Section } from "@/components/layout/Section";

import type { ProjectDetail } from "../project-detail-types";
import { presentableDeveloperName } from "../developer-identity";
import { hasOverviewSection } from "../project-sections";
import { buildingCodes, isAvailable, unitSizeRange } from "../unit-presentation";

/**
 * Overview (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * The description in prose, and the structured facts beside it in two columns
 * on desktop and one on mobile. Nothing raw appears here: no internal id, no
 * source filename, no Drive or Telegram reference, no local path. A row with no
 * recorded value is omitted rather than shown empty.
 */

export interface ProjectOverviewProps {
  project: ProjectDetail;
}

export function ProjectOverview({ project }: ProjectOverviewProps) {
  const description = project.core.description || project.core.tagline;
  const buildings = buildingCodes(project.units);
  const available = project.units.filter(isAvailable).length;

  const facts: Array<[string, string]> = [];
  const push = (label: string, value: string | number | null | undefined) => {
    const text = typeof value === "number" ? String(value) : (value ?? "").trim();
    if (text) facts.push([label, text]);
  };
  push("Property type", project.core.type);
  // Withheld when Forever's two sources name different developers (F2).
  push("Developer", presentableDeveloperName(project));
  push("Construction", project.core.constructionStatus);
  // Ownership is absent (F4): `projects.ownership_type` has no source evidence
  // behind it, and tenure is a legal claim about a purchase.
  if (buildings.length > 0) push("Buildings", buildings.join(", "));
  if (project.units.length > 0) push("Listed units", project.units.length);
  if (project.units.length > 0) push("Available now", available);
  push("Unit sizes", unitSizeRange(project.units));
  push("Location", project.location.area || project.core.location);
  push("Address", project.core.address);

  // Shared with the navigation (X1), so the Overview pill and the `id="overview"`
  // section are decided by one rule rather than two that disagree.
  if (!hasOverviewSection(project)) return null;

  return (
    <Section id="overview" eyebrow="Overview" title="About this project" className="pt-16 sm:pt-20">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14">
        {description ? (
          <div className="max-w-2xl">
            <p className="whitespace-pre-line text-base leading-8 text-muted-foreground">
              {description}
            </p>
          </div>
        ) : null}

        {facts.length > 0 ? (
          <dl className="grid gap-x-8 gap-y-3 self-start sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {facts.map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-2.5"
              >
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="text-right text-sm font-medium text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </Section>
  );
}
