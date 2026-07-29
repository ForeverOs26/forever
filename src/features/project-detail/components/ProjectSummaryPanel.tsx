import { Link } from "@tanstack/react-router";
import { Building2, CalendarCheck, Layers, MapPin, Ruler, Users } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { ProjectDetail } from "../project-detail-types";
import { projectContactActionsEnabled } from "../contact-actions";
import { presentableDeveloperName } from "../developer-identity";
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
  // Withheld when the linked record and the project's own source name different
  // developers (F2). Printing either side would assert one half of a
  // contradiction as fact.
  push(Building2, "Developer", presentableDeveloperName(project));
  push(Layers, "Property type", project.core.type);
  push(CalendarCheck, "Construction", project.core.constructionStatus);
  const buildings = buildingCodes(project.units);
  if (buildings.length > 0) push(Building2, "Buildings", buildings.length);
  if (project.units.length > 0) push(Users, "Listed units", project.units.length);
  push(Ruler, "Unit sizes", unitSizeRange(project.units));

  // Ownership is deliberately absent (finding F4). `projects.ownership_type` is
  // populated on exactly one of the nine public projects, on a legacy row the
  // Factory never writes, and no official source for any of them states
  // freehold, leasehold or foreign quota. Printing "Ownership: Freehold" from
  // that column states a legal fact about a purchase on no evidence.
  //
  // It stays absent until a source-backed, public-safe ownership contract
  // exists. Nothing here may infer it from project type, developer, unit type
  // or marketing copy.

  return rows;
}

export function ProjectSummaryPanel({ project, className }: ProjectSummaryPanelProps) {
  const rows = projectSummaryRows(project);
  const available = project.units.filter(isAvailable).length;
  const contactActionsEnabled = projectContactActionsEnabled();

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

      {/*
        The contact actions are withheld until gate G0 passes (F5). When they
        are absent and the project has no units either, the whole block —
        including its top border and spacing — is absent too, so the panel ends
        cleanly at the last fact rather than on an empty ruled area.
      */}
      {contactActionsEnabled || project.units.length > 0 ? (
        <div className="mt-6 grid gap-2.5 border-t border-border/60 pt-5">
          {contactActionsEnabled ? (
            <>
              {/*
                Both carry the project (FOREVER-CONTACT-G0-DELIVERY-AUDIT-001,
                severity #3). PR #116 shipped these as bare `/contact` links
                with no search params at all, so a click destroyed the one piece
                of context the enquiry needed — while the mobile bar, two files
                away, passed it. Carrying it here does NOT make the pipe work:
                the audit records that `/contact` does not yet read these params
                into the form and the leads table has no unit_code column. It
                only ensures the context is not thrown away at the click, so
                that when R1 lands there is something for it to read.
              */}
              <Button asChild size="lg">
                <Link to="/contact" search={{ project: project.core.name }}>
                  Request details
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/contact" search={{ project: project.core.name }}>
                  Request a viewing
                </Link>
              </Button>
            </>
          ) : null}
          {project.units.length > 0 ? (
            <a
              href="#units"
              className={`text-center text-sm font-medium text-accent underline-offset-4 hover:underline${
                contactActionsEnabled ? " mt-1" : ""
              }`}
            >
              {available > 0
                ? `See ${available} available ${available === 1 ? "unit" : "units"}`
                : "See the full unit list"}
            </a>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
