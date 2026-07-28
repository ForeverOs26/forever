/**
 * Which sections this project actually has
 * (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * The section navigation is built from this list, so a link can never scroll to
 * an empty destination: a project with no floor plans has no "Floor Plans"
 * entry at all, rather than an entry that lands on a blank strip. Deriving it
 * once, from the same data the sections render, is what keeps the two in step.
 */

import type { ProjectDetail, ProjectDetailMediaItem } from "./project-detail-types";

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

/** Facilities the project record states outright, as a clean list. */
export function projectFacilities(project: ProjectDetail): string[] {
  const seen = new Set<string>();
  const facilities: string[] = [];
  for (const raw of project.core.highlights) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    facilities.push(value);
  }
  return facilities;
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

export function projectSections(project: ProjectDetail): ProjectSection[] {
  const sections: ProjectSection[] = [];
  const add = (id: string, label: string, present: boolean) => {
    if (present) sections.push({ id, label });
  };

  add("overview", "Overview", Boolean(project.core.description || project.core.tagline));
  add("photos", "Photos", project.media.gallery.length > 0 || Boolean(project.media.hero));
  add("units", "Available Units", project.units.length > 0);
  add("facilities", "Facilities", projectFacilities(project).length > 0);
  add("master-plan", "Master Plan", Boolean(project.media.masterPlan));
  add("floor-plans", "Floor Plans", project.media.floorPlans.length > 0);
  add("unit-plans", "Unit Plans", project.media.unitPlans.length > 0);
  add("payment-plan", "Payment Plan", Boolean(paymentPlanDocument(project)));
  add("developer", "Developer", Boolean(project.developer?.name));
  add(
    "location",
    "Location",
    Boolean(project.location.area || project.core.location || project.core.address),
  );
  return sections;
}
