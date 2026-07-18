/**
 * Project link helpers.
 *
 * Every recommended project opens through the existing universal route
 * `/projects/<runtime-project-slug>`. The slug is always the one on the runtime
 * ProjectService record — never a hard-coded or import-engine slug. This is the
 * guard for the Modeva slug duality (display slug `the-modeva-bang-tao` vs the
 * import-engine identity `modeva`): whatever slug the record carries is echoed
 * straight through here.
 */

import type { Property } from "@/lib/data";

/** Universal in-app project path. Never prefixed with `/booth`. */
export function buildProjectPath(slug: string): string {
  return `/projects/${slug}`;
}

/** Absolute guest link for Copy-link, using the runtime record slug verbatim. */
export function buildGuestLink(origin: string, slug: string): string {
  const trimmed = origin.replace(/\/+$/, "");
  return `${trimmed}${buildProjectPath(slug)}`;
}

/** Convenience: derive the project path directly from a runtime record. */
export function projectPathFor(project: Pick<Property, "slug">): string {
  return buildProjectPath(project.slug);
}
