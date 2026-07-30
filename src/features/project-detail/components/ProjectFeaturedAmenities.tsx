import { Circle } from "lucide-react";

import { Section } from "@/components/layout/Section";

import type { DecisionDeckValue } from "../decision-deck-model";
import type { ProjectAmenity } from "../project-detail-types";

type FeaturedAmenitiesInput =
  | DecisionDeckValue<readonly ProjectAmenity[]>
  | readonly ProjectAmenity[];

export interface ProjectFeaturedAmenitiesProps {
  amenities: FeaturedAmenitiesInput;
}

function supportedAmenities(input: FeaturedAmenitiesInput): readonly ProjectAmenity[] {
  if ("state" in input) {
    return input.state === "supported" ? input.value : [];
  }
  return input;
}

/**
 * The compact, first-pass amenity list. Its marker is intentionally neutral:
 * an icon cannot imply that Forever independently inspected or verified an
 * amenity when this section only knows that the canonical record lists it.
 */
export function ProjectFeaturedAmenities({ amenities }: ProjectFeaturedAmenitiesProps) {
  const items = supportedAmenities(amenities).filter((amenity) => amenity.name.trim());
  if (items.length === 0) return null;

  return (
    <Section
      id="featured-amenities"
      eyebrow="Featured"
      title="Facilities & amenities"
      description="Recorded facilities and amenities marked as featured."
      className="py-11 sm:py-16"
      data-decision-deck-section=""
      data-testid="featured-amenities"
    >
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((amenity, index) => {
          const name = amenity.name.trim();
          const note = amenity.note.trim();
          return (
            <li
              key={`${amenity.id || amenity.slug || name}-${index}`}
              className="flex min-w-0 items-start gap-3 rounded-xl border border-border/60 bg-card p-4"
            >
              <span
                className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/10 text-accent"
                data-amenity-marker="neutral"
              >
                <Circle className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{name}</span>
                {note ? (
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {note}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
