import { ExternalLink, MapPin } from "lucide-react";

import { Section } from "@/components/layout/Section";

import type { DecisionDeckLocation, DecisionDeckValue } from "../decision-deck-model";

function supported<T>(
  value: DecisionDeckValue<T>,
): value is Extract<DecisionDeckValue<T>, { state: "supported" }> {
  return value.state === "supported";
}

export interface ProjectDecisionLocationProps {
  location: DecisionDeckValue<DecisionDeckLocation>;
}

export function ProjectDecisionLocation({ location }: ProjectDecisionLocationProps) {
  if (!supported(location)) return null;
  const fact = location.value;
  const rows = [
    fact.area ? ["Area", fact.area] : null,
    fact.address ? ["Address", fact.address] : null,
    fact.distanceToBeach ? ["Recorded beach distance", fact.distanceToBeach] : null,
    fact.distanceToAirport ? ["Recorded airport distance", fact.distanceToAirport] : null,
  ].filter((row): row is [string, string] => row !== null);
  const nearby = [
    fact.nearbySchools.length > 0 ? ["Nearby schools", fact.nearbySchools] : null,
    fact.nearbyHospitals.length > 0 ? ["Nearby hospitals", fact.nearbyHospitals] : null,
    fact.lifestyle.length > 0 ? ["Recorded nearby places", fact.lifestyle] : null,
  ].filter((group): group is [string, readonly string[]] => group !== null);
  const hasCoordinates = typeof fact.latitude === "number" && typeof fact.longitude === "number";
  const osmUrl = hasCoordinates
    ? `https://www.openstreetmap.org/?mlat=${fact.latitude}&mlon=${fact.longitude}#map=16/${fact.latitude}/${fact.longitude}`
    : null;

  return (
    <Section
      id="location"
      eyebrow="Location"
      title={fact.area || "Recorded location"}
      className="py-11 sm:py-16"
      data-decision-deck-section
      data-testid="project-location"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.75fr)]">
        <div className="space-y-5">
          {rows.length > 0 ? (
            <dl className="rounded-[18px] border border-border/70 bg-card p-5">
              {rows.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-start justify-between gap-5 border-b border-border/60 py-3 first:pt-0 last:border-0 last:pb-0"
                >
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="max-w-[65%] text-right text-sm font-medium text-foreground">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {nearby.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {nearby.map(([label, values]) => (
                <div key={label} className="rounded-[18px] border border-border/70 bg-card p-5">
                  <h3 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    {label}
                  </h3>
                  <ul className="mt-3 space-y-2 text-sm text-foreground">
                    {values.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {osmUrl || fact.mapDocument ? (
          <div className="flex flex-col justify-center rounded-[18px] border border-border/70 bg-secondary/50 p-5">
            <MapPin className="h-5 w-5 text-accent" aria-hidden="true" />
            <p className="mt-3 text-sm text-muted-foreground">
              Open only the location source recorded for this project.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              {osmUrl ? (
                <a
                  href={osmUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  OpenStreetMap <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null}
              {fact.mapDocument ? (
                <a
                  href={fact.mapDocument.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Recorded map <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
