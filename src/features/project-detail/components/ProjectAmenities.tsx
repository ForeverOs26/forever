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
 * Groups amenities for display, honouring the Owner's featured choice first.
 *
 * Two rules are in tension. The ordering contract puts featured amenities ahead
 * of everything else; category grouping wants every "Pools & Water" row
 * together. Re-grouping the whole list by category would silently discard the
 * first rule, so the featured amenities are lifted into their own leading group
 * and only the remainder is grouped by category. A buyer then reads the six
 * things the Owner chose to lead with, then the full list organised by kind.
 *
 * When nothing is featured — the state every project is in until the Owner
 * opens the editor — this degrades to exactly the previous behaviour: group by
 * category, or one flat list when a category does not actually separate
 * anything. A lone subheading above every item is noise, not structure.
 *
 * The mapper no longer orders by category first, so groups are collected by
 * first appearance rather than assumed contiguous.
 */
function amenityGroups(
  amenities: ProjectAmenity[],
): { category: string; items: ProjectAmenity[] }[] {
  const featured = amenities.filter((amenity) => amenity.isFeatured);
  const rest = amenities.filter((amenity) => !amenity.isFeatured);

  const byCategory = (items: ProjectAmenity[]): { category: string; items: ProjectAmenity[] }[] => {
    const categories = new Set(items.map((amenity) => amenity.category).filter(Boolean));
    if (categories.size < 2) return items.length ? [{ category: "", items }] : [];

    const groups: { category: string; items: ProjectAmenity[] }[] = [];
    for (const amenity of items) {
      const existing = groups.find((group) => group.category === amenity.category);
      if (existing) {
        existing.items.push(amenity);
      } else {
        groups.push({ category: amenity.category, items: [amenity] });
      }
    }
    return groups;
  };

  if (!featured.length) return byCategory(amenities);
  return [{ category: "Featured", items: featured }, ...byCategory(rest)];
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
        {groups.map((group, index) => (
          // Indexed because a "Featured" group and a category can, in principle,
          // carry the same label.
          <div key={`${index}-${group.category}`}>
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
