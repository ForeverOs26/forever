import {
  Bath,
  Bike,
  Building2,
  Car,
  Circle,
  Dumbbell,
  Flower2,
  Gamepad2,
  Shield,
  ShieldCheck,
  Sparkles,
  Trees,
  Utensils,
  Waves,
  Wifi,
  type LucideIcon,
} from "lucide-react";

import { Section } from "@/components/layout/Section";

import type { DecisionDeckValue } from "../decision-deck-model";
import type { ProjectAmenity } from "../project-detail-types";

const ICONS: Readonly<Record<string, LucideIcon>> = {
  bath: Bath,
  bicycle: Bike,
  bike: Bike,
  building: Building2,
  car: Car,
  concierge: ShieldCheck,
  fitness: Dumbbell,
  garden: Flower2,
  gym: Dumbbell,
  kids: Gamepad2,
  park: Trees,
  parking: Car,
  playground: Gamepad2,
  pool: Waves,
  restaurant: Utensils,
  sauna: Bath,
  security: Shield,
  spa: Sparkles,
  wellness: Sparkles,
  wifi: Wifi,
};

function amenityIcon(value: string): LucideIcon {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  // An unknown icon token is an absence of icon evidence, not a verified
  // checkmark. A neutral outline preserves the row without adding a claim.
  return ICONS[key] ?? Circle;
}

function supported<T>(
  value: DecisionDeckValue<T>,
): value is Extract<DecisionDeckValue<T>, { state: "supported" }> {
  return value.state === "supported";
}

export interface ProjectDecisionAmenitiesProps {
  amenities: DecisionDeckValue<readonly ProjectAmenity[]>;
}

export function ProjectDecisionAmenities({ amenities }: ProjectDecisionAmenitiesProps) {
  if (!supported(amenities)) return null;

  return (
    <Section
      id="amenities"
      eyebrow="Full amenities"
      title="All recorded facilities"
      description="Canonical project-amenity relations only."
      className="py-11 sm:py-16"
      data-decision-deck-section
      data-testid="full-amenities"
    >
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {amenities.value.map((amenity) => {
          const Icon = amenityIcon(amenity.icon);
          const category = amenity.isFeatured ? "Featured" : amenity.category.trim();
          return (
            <li
              key={amenity.id || amenity.slug || amenity.name}
              className="flex min-h-14 items-start gap-3 rounded-xl border border-border/60 bg-card p-4"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <div>
                {category ? (
                  <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {category}
                  </p>
                ) : null}
                <p className={category ? "mt-1 text-sm font-medium" : "text-sm font-medium"}>
                  {amenity.name}
                </p>
                {amenity.note ? (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{amenity.note}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
