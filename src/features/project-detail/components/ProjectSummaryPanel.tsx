import { Link } from "@tanstack/react-router";
import { Building2, CalendarCheck, KeySquare, Layers, MapPin, Ruler, Users } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { ProjectDetail } from "../project-detail-types";
import { buildingCodes, isAvailable, unitSizeRange } from "../unit-presentation";

/**
 * The summary and contact panel beside the photographs
 * (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * Every row here is a field the public projection actually carries. A project
 * with no recorded developer shows no developer row rather than an empty label,
 * and a project with no starting price says "Price on request" rather than
 * printing a zero.
 *
 * The actions are the two Forever genuinely implements: the advisory contact
 * route, and the same route pre-framed as a viewing request. There is no
 * calendar and no offer flow, because no booking backend exists to honour
 * either — a date picker that quietly does nothing is worse than an honest
 * form.
 */

export interface ProjectSummaryPanelProps {
  project: ProjectDetail;
  /** Rendered inside a sticky wrapper by the caller on wide screens. */
  className?: string;
}

interface SummaryRow {
  icon: typeof MapPin;
  label: string;
  value: string;
}

export function projectSummaryRows(project: ProjectDetail): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const push = (icon: typeof MapPin, label: string, value: string | number | null | undefined) => {
    const text = typeof value === "number" ? String(value) : (value ?? "").trim();
    if (!text) return;
    rows.push({ icon, label, value: text });
  };

  push(MapPin, "Location", project.location.area || project.core.location);
  push(Building2, "Developer", project.developer?.name || project.core.developerNameRaw);
  push(Layers, "Property type", project.core.type);
  push(CalendarCheck, "Construction", project.core.constructionStatus);
  const buildings = buildingCodes(project.units);
  if (buildings.length > 0) push(Building2, "Buildings", buildings.length);
  if (project.units.length > 0) push(Users, "Listed units", project.units.length);
  push(Ruler, "Unit sizes", unitSizeRange(project.units));
  push(KeySquare, "Ownership", project.core.ownershipType);
  return rows;
}

export function ProjectSummaryPanel({ project, className }: ProjectSummaryPanelProps) {
  const rows = projectSummaryRows(project);
  const available = project.units.filter(isAvailable).length;

  return (
    <aside
      data-testid="project-summary-panel"
      aria-label={`${project.core.name} summary`}
      className={`rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6 ${className ?? ""}`}
    >
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {project.pricing.displayPrice ? "Starting price" : "Price"}
        </p>
        <p className="mt-1.5 font-serif text-3xl leading-none text-foreground sm:text-4xl">
          {project.pricing.displayPrice || "Price on request"}
        </p>
        {project.pricing.priceRange ? (
          <p className="mt-2 text-sm text-muted-foreground">{project.pricing.priceRange}</p>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <dl className="mt-5 grid gap-3 border-t border-border/60 pt-5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-4">
              <dt className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <row.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {row.label}
              </dt>
              <dd className="text-right text-sm font-medium text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mt-6 grid gap-2.5 border-t border-border/60 pt-5">
        <Button asChild size="lg">
          <Link to="/contact">Request details</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link to="/contact">Request a viewing</Link>
        </Button>
        {project.units.length > 0 ? (
          <a
            href="#units"
            className="mt-1 text-center text-sm font-medium text-accent underline-offset-4 hover:underline"
          >
            {available > 0
              ? `See ${available} available ${available === 1 ? "unit" : "units"}`
              : "See the full unit list"}
          </a>
        ) : null}
      </div>
    </aside>
  );
}
