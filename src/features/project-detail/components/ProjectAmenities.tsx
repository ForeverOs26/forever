import {
  Bath,
  Bike,
  Building2,
  Car,
  Check,
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

import type { ProjectAmenity, ProjectDetail } from "../project-detail-types";
import { hasAmenitiesSection, projectAmenities } from "../project-sections";

/**
 * Facilities & Amenities (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * Only the amenities the project record states, read from the canonical
 * `project_amenities` → `amenities` relation and from nothing else. Nothing is
 * inferred from a photograph, a highlight or a description: a render that
 * happens to show water is not evidence of a communal pool, and a project with
 * no recorded amenities shows no section rather than a plausible-looking list.
 *
 * The heading says "Facilities & Amenities" because that is what a buyer calls
 * this; the data behind it is `amenities` throughout.
 */

/**
 * Icons the design system actually ships, keyed by the slug an amenity row may
 * carry in `amenities.icon`.
 *
 * The column is free text, not a constrained enum, so an unrecognised value
 * falls back to the neutral check mark. Rendering an arbitrary string as an
 * icon name is how you get a blank square — or, with a dynamic lookup, a crash
 * on a page that was otherwise fine.
 */
const AMENITY_ICONS: Record<string, LucideIcon> = {
  bath: Bath,
  bicycle: Bike,
  bike: Bike,
  building: Building2,
  car: Car,
  check: Check,
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

function amenityIcon(icon: string): LucideIcon {
  const key = icon
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  return AMENITY_ICONS[key] ?? Check;
}

/**
 * Groups amenities by category, but only when a category actually separates
 * them. One category — or none — is a single flat list, because a lone
 * subheading above every item is noise, not structure.
 *
 * The mapper already ordered the rows by category, so walking them in order
 * yields contiguous groups without a second sort.
 */
function amenityGroups(
  amenities: ProjectAmenity[],
): { category: string; items: ProjectAmenity[] }[] {
  const categories = new Set(amenities.map((amenity) => amenity.category).filter(Boolean));
  if (categories.size < 2) return [{ category: "", items: amenities }];

  const groups: { category: string; items: ProjectAmenity[] }[] = [];
  for (const amenity of amenities) {
    const existing = groups.find((group) => group.category === amenity.category);
    if (existing) {
      existing.items.push(amenity);
    } else {
      groups.push({ category: amenity.category, items: [amenity] });
    }
  }
  return groups;
}

export interface ProjectAmenitiesProps {
  project: ProjectDetail;
}

export function ProjectAmenities({ project }: ProjectAmenitiesProps) {
  if (!hasAmenitiesSection(project)) return null;
  const groups = amenityGroups(projectAmenities(project));

  return (
    <Section
      id="amenities"
      eyebrow="Facilities & Amenities"
      title="What the project includes"
      className="pt-0"
      data-testid="project-amenities"
    >
      <div className="space-y-10">
        {groups.map((group) => (
          <div key={group.category || "all"}>
            {group.category && (
              <h3 className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                {group.category}
              </h3>
            )}
            <ul className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((amenity) => {
                const Icon = amenityIcon(amenity.icon);
                return (
                  <li
                    key={amenity.id || amenity.slug || amenity.name}
                    className="flex items-start gap-3 border-b border-border/50 pb-3"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                    <div className="min-w-0">
                      <span className="text-sm text-foreground">{amenity.name}</span>
                      {amenity.note && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{amenity.note}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}
