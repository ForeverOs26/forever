/**
 * Progressive ingestion — non-blocking canonical dependency resolution.
 *
 * The classification taxonomy mirrors the strict lane's RC5.6P dependency
 * findings (`collision-inspector.ts`): present-exactly-once, absent,
 * ambiguous, and identity/null-natural-key states. In the progressive lane
 * these become link decisions and warnings instead of blockers; only an
 * exact single slug match is safe enough to auto-link.
 */

import { slugify } from "@/import/persistence-projection";

export interface DependencyCandidate {
  id: string;
  slug: string | null;
  name: string;
}

export interface DependencyReader {
  findDevelopers(query: { slug: string; name: string }): Promise<DependencyCandidate[]>;
  findLocations(query: { slug: string; name: string }): Promise<DependencyCandidate[]>;
}

export type DependencyResolution =
  | { outcome: "linked"; id: string }
  | { outcome: "unresolved" }
  | { outcome: "needs_confirmation"; candidateId: string }
  | { outcome: "ambiguous"; candidateIds: string[] }
  | { outcome: "skipped" };

function classify(
  raw: string,
  slug: string,
  rows: DependencyCandidate[],
): DependencyResolution {
  const normalizedName = raw.trim().toLowerCase();
  const bySlug = rows.filter((row) => row.slug === slug);
  if (bySlug.length === 1) return { outcome: "linked", id: bySlug[0].id };
  if (bySlug.length > 1) {
    return { outcome: "ambiguous", candidateIds: bySlug.map((row) => row.id) };
  }
  const byName = rows.filter((row) => row.name.trim().toLowerCase() === normalizedName);
  if (byName.length === 1) {
    // Exact name but a null or different slug: propose, never auto-link.
    return { outcome: "needs_confirmation", candidateId: byName[0].id };
  }
  if (byName.length > 1) {
    return { outcome: "ambiguous", candidateIds: byName.map((row) => row.id) };
  }
  return { outcome: "unresolved" };
}

export async function resolveDeveloper(
  reader: DependencyReader,
  rawName: string | null | undefined,
): Promise<DependencyResolution> {
  const raw = rawName?.trim();
  if (!raw) return { outcome: "skipped" };
  return classify(raw, slugify(raw), await reader.findDevelopers({ slug: slugify(raw), name: raw }));
}

export async function resolveLocation(
  reader: DependencyReader,
  rawName: string | null | undefined,
): Promise<DependencyResolution> {
  const raw = rawName?.trim();
  if (!raw) return { outcome: "skipped" };
  return classify(raw, slugify(raw), await reader.findLocations({ slug: slugify(raw), name: raw }));
}
