/**
 * Forever Canonical Project Database — canonical sections.
 *
 * A {@link ProjectSection} is the architecture descriptor of one canonical
 * region of a project record: General, Developer, Location, Construction,
 * Units, Pricing, Payment, Investment, Rental, Amenities, Legal, Facilities,
 * Timeline, Documents, Media, Notes, and the explicit Unknown for a field
 * whose region cannot yet be classified. The vocabulary is closed and its
 * declared order is the module's one canonical section order — the deep
 * structural rank every field sort and grouping derives from.
 *
 * These are architecture descriptors only: no UI, no layout, no rendering.
 * A section says *where a canonical field belongs*, never how it is shown —
 * presentation stays a future release's concern. Deliberately distinct from
 * the RC4.2 template components (which describe page structure) and from the
 * RC4.5 fact types (which describe what an extraction reads): a section
 * organizes the canonical record itself.
 */

/** The key of one canonical section of a project record. */
export type ProjectSectionKey =
  | "general"
  | "developer"
  | "location"
  | "construction"
  | "units"
  | "pricing"
  | "payment"
  | "investment"
  | "rental"
  | "amenities"
  | "legal"
  | "facilities"
  | "timeline"
  | "documents"
  | "media"
  | "notes"
  | "unknown";

/** Every {@link ProjectSectionKey}, in the canonical section order. */
export const PROJECT_SECTION_KEYS = [
  "general",
  "developer",
  "location",
  "construction",
  "units",
  "pricing",
  "payment",
  "investment",
  "rental",
  "amenities",
  "legal",
  "facilities",
  "timeline",
  "documents",
  "media",
  "notes",
  "unknown",
] as const satisfies readonly ProjectSectionKey[];

/** Runtime guard: whether a value is a known {@link ProjectSectionKey}. */
export function isKnownProjectSectionKey(value: unknown): value is ProjectSectionKey {
  return typeof value === "string" && (PROJECT_SECTION_KEYS as readonly string[]).includes(value);
}

/** The architecture descriptor of one canonical section. */
export interface ProjectSection {
  key: ProjectSectionKey;
  /** Human-readable display name, e.g. `Pricing`. */
  name: string;
  /** Position in the canonical section order, 0-based. */
  order: number;
  /** What the section holds — a description, never a layout. */
  description?: string;
}

/** Display names of the canonical sections, keyed by section key. */
const PROJECT_SECTION_NAMES: Record<ProjectSectionKey, string> = {
  general: "General",
  developer: "Developer",
  location: "Location",
  construction: "Construction",
  units: "Units",
  pricing: "Pricing",
  payment: "Payment",
  investment: "Investment",
  rental: "Rental",
  amenities: "Amenities",
  legal: "Legal",
  facilities: "Facilities",
  timeline: "Timeline",
  documents: "Documents",
  media: "Media",
  notes: "Notes",
  unknown: "Unknown",
};

/** Rank of each section in the canonical order; lower comes first. */
const PROJECT_SECTION_RANK: Record<ProjectSectionKey, number> = Object.fromEntries(
  PROJECT_SECTION_KEYS.map((key, index) => [key, index]),
) as Record<ProjectSectionKey, number>;

/** The rank of a section key in the canonical order; lower comes first. */
export function projectSectionRank(key: ProjectSectionKey): number {
  return PROJECT_SECTION_RANK[key];
}

/**
 * Comparator ordering section keys in the canonical section order.
 *
 * Suitable for `Array.prototype.sort`: negative when `a` comes before `b`.
 * Pure and total.
 */
export function compareProjectSections(a: ProjectSectionKey, b: ProjectSectionKey): number {
  return PROJECT_SECTION_RANK[a] - PROJECT_SECTION_RANK[b];
}

/**
 * The full descriptor of one canonical section.
 *
 * Deterministic and pure: the same key always yields an equal, independent
 * value — the returned descriptor never aliases module state, so mutating it
 * can never reach the vocabulary.
 */
export function projectSectionFor(key: ProjectSectionKey): ProjectSection {
  return { key, name: PROJECT_SECTION_NAMES[key], order: PROJECT_SECTION_RANK[key] };
}

/** Every canonical {@link ProjectSection} descriptor, in canonical order. */
export function listProjectSections(): ProjectSection[] {
  return PROJECT_SECTION_KEYS.map(projectSectionFor);
}

/**
 * The canonical section a dotted field path belongs to: the first path
 * segment when it names a known section, and the explicit `unknown`
 * otherwise — a field whose region cannot be classified says so, it is never
 * guessed into a section (anti-fabrication).
 *
 * Pure and total: any string maps deterministically, e.g.
 * `pricing.basePrice` → `pricing`, `unclassified.thing` → `unknown`.
 */
export function projectSectionForPath(path: string): ProjectSectionKey {
  if (typeof path !== "string") return "unknown";
  const head = path.split(".", 1)[0].toLowerCase();
  return isKnownProjectSectionKey(head) ? head : "unknown";
}
