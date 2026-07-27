import { Building2, CalendarCheck, Coins, KeySquare, Layers, Ruler, Users } from "lucide-react";

import type { ProjectDetail } from "../project-detail-types";
import { buildingCodes, isAvailable, unitSizeRange } from "../unit-presentation";

/**
 * The fact row under the photographs
 * (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * Only facts the record carries. Bathrooms, furniture state, rental yield, pet
 * policy, CAM fee and a specific completion month are all absent on purpose:
 * Forever does not hold them for these projects, and a confident-looking tile
 * containing a guess is worse than no tile.
 *
 * A fact with no value is not rendered at all, so a sparse project shows four
 * tiles rather than nine labels above nine dashes.
 */

export interface ProjectQuickFactsProps {
  project: ProjectDetail;
}

interface Fact {
  icon: typeof Building2;
  label: string;
  value: string;
}

export function projectQuickFacts(project: ProjectDetail): Fact[] {
  const facts: Fact[] = [];
  const push = (
    icon: typeof Building2,
    label: string,
    value: string | number | null | undefined,
  ) => {
    const text = typeof value === "number" ? String(value) : (value ?? "").trim();
    if (!text) return;
    facts.push({ icon, label, value: text });
  };

  push(Coins, "Starting price", project.pricing.displayPrice);
  const buildings = buildingCodes(project.units);
  if (buildings.length > 0) push(Building2, "Buildings", buildings.length);
  if (project.units.length > 0) push(Users, "Listed units", project.units.length);
  const available = project.units.filter(isAvailable).length;
  if (project.units.length > 0) push(Layers, "Available now", available);
  push(Ruler, "Unit sizes", unitSizeRange(project.units));
  push(CalendarCheck, "Construction", project.core.constructionStatus);
  push(KeySquare, "Ownership", project.core.ownershipType);
  return facts;
}

export function ProjectQuickFacts({ project }: ProjectQuickFactsProps) {
  const facts = projectQuickFacts(project);
  if (facts.length === 0) return null;

  return (
    <dl
      data-testid="project-quick-facts"
      className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/70 bg-border/70 sm:grid-cols-3 lg:grid-cols-4"
    >
      {facts.map((fact) => (
        <div key={fact.label} className="bg-card px-4 py-4">
          <dt className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <fact.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {fact.label}
          </dt>
          <dd className="mt-1.5 text-base font-medium text-foreground">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
