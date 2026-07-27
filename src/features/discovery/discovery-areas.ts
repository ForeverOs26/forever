/**
 * Area facet for public Discovery (F-002).
 *
 * The area dropdown used to be a hardcoded list written before the current
 * catalogue existed. It offered Surin Beach, Kamala, Layan and Kata Noi — four
 * areas with no public project between them at the time of the audit — while
 * omitting Nai Yang (The Title Serenity) and Kata (The Katabello) entirely, so
 * two saleable projects could not be reached by area at all.
 *
 * A hardcoded list is the wrong shape for this: it has to be edited every time
 * a project is published, and nothing fails when someone forgets. The options
 * are now derived from the catalogue that is actually loaded, so an area
 * appears exactly when a project is there and disappears when none is.
 *
 * Comparison is normalised (case and internal whitespace), so `Bang Tao`,
 * `bang tao` and `Bang  Tao` are one area rather than three. The label shown
 * is the first spelling the catalogue itself uses, which keeps the dropdown in
 * the record's own words instead of a re-cased guess at a Thai place name.
 */

/** The reset option. Selecting it must never remove a project from the list. */
export const ALL_AREAS = "All areas" as const;

/** Fold an area for comparison: case-insensitive, whitespace-insensitive. */
export function normalizeArea(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Collapse internal whitespace without touching the record's own casing. */
function displayArea(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * The areas present in this catalogue, deduplicated and sorted.
 *
 * Sorting is locale-aware and case-insensitive so the dropdown reads the way a
 * buyer expects; deduplication keeps the first spelling encountered, which is
 * stable because the catalogue arrives in the service's own stable order.
 */
export function deriveAreaOptions(areas: readonly (string | null | undefined)[]): string[] {
  const byKey = new Map<string, string>();
  for (const raw of areas) {
    const key = normalizeArea(raw);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, displayArea(raw as string));
  }
  return [...byKey.values()].sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" }),
  );
}
