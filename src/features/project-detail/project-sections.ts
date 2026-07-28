/**
 * Which sections this project actually has
 * (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * The section navigation is built from this list, so a link can never scroll to
 * an empty destination: a project with no floor plans has no "Floor Plans"
 * entry at all, rather than an entry that lands on a blank strip. Deriving it
 * once, from the same data the sections render, is what keeps the two in step.
 */

import { developerIdentity, presentableDeveloperName } from "./developer-identity";
import { renderablePlan, renderablePlans } from "./plan-media";
import type { ProjectAmenity, ProjectDetail, ProjectDetailMediaItem } from "./project-detail-types";
import { buildingCodes, isAvailable, unitSizeRange } from "./unit-presentation";

/**
 * The project's photographs, cover first, in the order the publish lane
 * recorded — and nothing else.
 *
 * Plans, maps and brochures are excluded deliberately. A floor plan sitting
 * among the photographs is what made the old gallery hard to read, and it is
 * also what would put a drawing on the first screen.
 */
export function projectPhotographs(project: ProjectDetail): ProjectDetailMediaItem[] {
  const photographs: ProjectDetailMediaItem[] = [];
  const seen = new Set<string>();
  const add = (item: ProjectDetailMediaItem | null) => {
    if (!item?.url || seen.has(item.url)) return;
    seen.add(item.url);
    photographs.push(item);
  };
  add(project.media.hero);
  for (const item of project.media.gallery) add(item);
  return photographs;
}

/**
 * The one image that represents this project off-site — Open Graph, Twitter and
 * JSON-LD (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001).
 *
 * Deliberately the same list the mosaic and the lightbox render, taken from the
 * front, rather than a second expression of "hero, or else the first gallery
 * item". The social image is the copy of a project that travels furthest and is
 * cached longest by parties Forever does not control, so it is the last place a
 * prohibited photograph should be able to reach through a reader of its own.
 *
 * `null` is a complete answer. A project with no presentable photograph emits no
 * `og:image` and no JSON-LD `image`, because every available substitute — a
 * stock coastline, another project's render, a brand graphic — would show a
 * property that is not this one.
 */
export function projectSocialImage(project: ProjectDetail): string | null {
  return projectPhotographs(project)[0]?.url ?? null;
}

export interface ProjectSection {
  id: string;
  label: string;
}

/**
 * Amenities the project record states outright (finding F3).
 *
 * Reads `project.amenities` — the canonical `project_amenities` → `amenities`
 * relation — and nothing else.
 *
 * It previously read `project.core.highlights`. Highlights are editorial
 * one-liners, not amenities: Modeva's three are "Forever Verified project
 * record", "Bang Tao location" and "Structured project foundation". Under a
 * heading promising what the project includes, those assert three things the
 * developer never said, about the only project that had any.
 *
 * Nothing may be inferred here from highlights, descriptions, photographs or
 * generic project records. The mapper has already deduplicated and ordered the
 * rows; this guard exists because `ProjectDetail` is also built by demo and
 * fixture code paths that do not go through the mapper.
 */
export function projectAmenities(project: ProjectDetail): ProjectAmenity[] {
  const seen = new Set<string>();
  const amenities: ProjectAmenity[] = [];
  for (const amenity of project.amenities ?? []) {
    if (!amenity) continue;
    const name = (amenity.name ?? "").trim();
    if (!name) continue;
    const key = ((amenity.id ?? "").trim() || (amenity.slug ?? "").trim() || name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    amenities.push(amenity);
  }
  return amenities;
}

/**
 * The amenity names alone, for callers that only need a list of labels.
 */
export function projectAmenityNames(project: ProjectDetail): string[] {
  return projectAmenities(project).map((amenity) => amenity.name);
}

/**
 * The official payment-plan document, when one exists.
 *
 * Only ever a document. Forever holds no structured instalment rows for these
 * projects, and a table assembled from marketing copy would be an invention, so
 * the section offers the verified file and states nothing else.
 */
export function paymentPlanDocument(project: ProjectDetail) {
  return project.media.documents.find((document) => document.type === "payment_plan") ?? null;
}

/**
 * The gallery renders only when there are enough photographs to be a gallery.
 *
 * `ProjectPhotos` has always applied this threshold; the navigation did not,
 * so any project with one to five photographs — the commonest case — got a
 * "Photos" pill pointing at an `#photos` element that is never rendered. The
 * observer in `ProjectSectionNav` silently skips a missing target, so the pill
 * simply did nothing when clicked and could never become active.
 */
export const PHOTO_GALLERY_MINIMUM = 6;

export function hasPhotosSection(project: ProjectDetail): boolean {
  return projectPhotographs(project).length >= PHOTO_GALLERY_MINIMUM;
}

export function hasMasterPlanSection(project: ProjectDetail): boolean {
  return renderablePlan(project.media.masterPlan) !== null;
}

export function hasFloorPlansSection(project: ProjectDetail): boolean {
  return renderablePlans(project.media.floorPlans).length > 0;
}

export function hasUnitPlansSection(project: ProjectDetail): boolean {
  return renderablePlans(project.media.unitPlans).length > 0;
}

export function hasAmenitiesSection(project: ProjectDetail): boolean {
  return projectAmenities(project).length > 0;
}

export function hasDeveloperSection(project: ProjectDetail): boolean {
  return developerIdentity(project).state === "named";
}

export function hasPaymentPlanSection(project: ProjectDetail): boolean {
  return paymentPlanDocument(project) !== null;
}

export function hasUnitsSection(project: ProjectDetail): boolean {
  return project.units.length > 0;
}

/** The map document `ProjectLocation` offers, when the project has one. */
export function locationMapDocument(project: ProjectDetail) {
  return (
    project.media.documents.find(
      (document) => document.type === "document" && document.semanticRole === "map",
    ) ??
    project.media.documents.find(
      (document) =>
        document.type === "document" &&
        !document.semanticRole &&
        /map/i.test(document.label + document.title),
    ) ?? null
  );
}

export function hasLocationSection(project: ProjectDetail): boolean {
  const area = project.location.area || project.core.location;
  const hasCoordinates =
    typeof project.location.latitude === "number" && typeof project.location.longitude === "number";
  return Boolean(area || project.core.address || hasCoordinates || locationMapDocument(project));
}

export function hasOverviewSection(project: ProjectDetail): boolean {
  return (
    Boolean(project.core.description || project.core.tagline) ||
    projectOverviewFactCount(project) > 0
  );
}

/**
 * How many structured facts the Overview would list.
 *
 * `ProjectOverview` renders when it has a description *or* any fact, so the
 * navigation has to count the facts too — otherwise a project with facts but no
 * prose renders `id="overview"` with no pill pointing at it.
 */
export function projectOverviewFactCount(project: ProjectDetail): number {
  let count = 0;
  const has = (value: string | number | null | undefined) => {
    const text = typeof value === "number" ? String(value) : (value ?? "").trim();
    if (text) count += 1;
  };

  has(project.core.type);
  has(presentableDeveloperName(project));
  has(project.core.constructionStatus);
  const buildings = buildingCodes(project.units);
  if (buildings.length > 0) has(buildings.join(", "));
  if (project.units.length > 0) has(project.units.length);
  if (project.units.length > 0) has(project.units.filter(isAvailable).length);
  has(unitSizeRange(project.units));
  has(project.location.area || project.core.location);
  has(project.core.address);
  return count;
}

/**
 * The sections this project actually renders.
 *
 * Every entry is decided by the *same* predicate the corresponding component
 * renders on, imported from here rather than re-derived. That is the whole
 * point: the original file promised "a link can never scroll to an empty
 * destination" while gating six of its ten entries on looser conditions than
 * the components applied.
 */
export function projectSections(project: ProjectDetail): ProjectSection[] {
  const sections: ProjectSection[] = [];
  const add = (id: string, label: string, present: boolean) => {
    if (present) sections.push({ id, label });
  };

  add("overview", "Overview", hasOverviewSection(project));
  add("photos", "Photos", hasPhotosSection(project));
  add("units", "Available Units", hasUnitsSection(project));
  add("amenities", "Facilities & Amenities", hasAmenitiesSection(project));
  add("master-plan", "Master Plan", hasMasterPlanSection(project));
  add("floor-plans", "Floor Plans", hasFloorPlansSection(project));
  add("unit-plans", "Unit Plans", hasUnitPlansSection(project));
  add("payment-plan", "Payment Plan", hasPaymentPlanSection(project));
  add("developer", "Developer", hasDeveloperSection(project));
  add("location", "Location", hasLocationSection(project));
  return sections;
}
