import { MapPin } from "lucide-react";

import { Section } from "@/components/layout/Section";

import type { ProjectDetail } from "../project-detail-types";
import { hasLocationSection, locationMapDocument } from "../project-sections";

/**
 * Location (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * Area and address as recorded, plus the location-map document when the
 * publish lane classified one. No embedded map is drawn unless the project has
 * real coordinates, and no distance to a beach, school or airport is printed
 * unless the record states it — an invented "2 km to Bang Tao" is the kind of
 * number a buyer plans around.
 */

export interface ProjectLocationProps {
  project: ProjectDetail;
}

export function ProjectLocation({ project }: ProjectLocationProps) {
  const area = project.location.area || project.core.location;
  const address = project.core.address;
  const hasCoordinates =
    typeof project.location.latitude === "number" && typeof project.location.longitude === "number";
  const locationDocument = locationMapDocument(project);

  const nearby: Array<[string, string]> = [];
  if (project.location.distanceToBeach) nearby.push(["Beach", project.location.distanceToBeach]);
  if (project.location.distanceToAirport)
    nearby.push(["Airport", project.location.distanceToAirport]);

  // One predicate, shared with the navigation, so a pill can never point at a
  // section this returns null for.
  if (!hasLocationSection(project)) return null;

  return (
    <Section
      id="location"
      eyebrow="Location"
      title={area || "Location"}
      className="pt-0"
      data-testid="project-location"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <dl className="grid gap-3">
            {area ? (
              <div className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-2.5">
                <dt className="text-sm text-muted-foreground">Area</dt>
                <dd className="text-right text-sm font-medium text-foreground">{area}</dd>
              </div>
            ) : null}
            {address ? (
              <div className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-2.5">
                <dt className="text-sm text-muted-foreground">Address</dt>
                <dd className="text-right text-sm font-medium text-foreground">{address}</dd>
              </div>
            ) : null}
            {nearby.map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-2.5"
              >
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="text-right text-sm font-medium text-foreground">{value}</dd>
              </div>
            ))}
          </dl>

          {hasCoordinates ? (
            <a
              className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-accent underline-offset-4 hover:underline"
              href={`https://www.openstreetmap.org/?mlat=${project.location.latitude}&mlon=${project.location.longitude}#map=15/${project.location.latitude}/${project.location.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MapPin className="h-4 w-4" />
              Open the location on a map
            </a>
          ) : null}
        </div>

        {locationDocument ? (
          <figure className="overflow-hidden rounded-2xl border border-border/70 bg-card">
            <img
              src={locationDocument.url}
              alt={`${project.core.name} location map`}
              loading="lazy"
              className="aspect-[16/9] w-full bg-secondary object-cover"
            />
            <figcaption className="px-4 py-3 text-sm text-muted-foreground">
              Official location map
            </figcaption>
          </figure>
        ) : null}
      </div>
    </Section>
  );
}
