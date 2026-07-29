/**
 * Forever Studio — pure state for the project amenities editor
 * (FOREVER-STUDIO-AMENITIES-CORE-001).
 *
 * Every decision the "Facilities & Amenities" section makes about ORDER,
 * SEARCH, IDENTITY and the SAVE PAYLOAD lives here as a pure function over
 * plain values, for two reasons:
 *
 *   1. The rules are contractual, not cosmetic. `sort_order` is renumbered in
 *      fixed steps per group, a slug is kebab-case, and the payload is the
 *      EXACT final set — all three are re-checked by
 *      `studio_save_project_amenities` and a mismatch is a refused save, not a
 *      rendering glitch. Rules of that weight must be testable without a DOM.
 *   2. The component and its tests then agree by construction. A test that
 *      asserted ordering by clicking buttons would be asserting React, not the
 *      rule; here it asserts the rule directly and the component simply calls
 *      the same function.
 *
 * Client-safe by construction: plain data in, plain data out, no imports from
 * `./server/*`, no network, no clock, no randomness. Every function returns a
 * fresh array — never a mutated argument — because the caller holds these
 * values in React state, where in-place mutation silently skips a re-render.
 */

import {
  STUDIO_MAX_FEATURED_AMENITIES,
  type StudioAmenityCatalogueEntry,
  type StudioProjectAmenity,
} from "./studio-types";

/**
 * Step between consecutive `sort_order` values within one group.
 *
 * Gaps rather than 1, 2, 3 are deliberate: a later save can insert between two
 * amenities without rewriting every following row, and a row that arrives from
 * an older save at some arbitrary value still sorts sensibly against these.
 * The database only requires `sort_order >= 0`; the spacing is this editor's
 * convention.
 */
export const AMENITY_SORT_STEP = 10;

/** The category filter value that means "do not filter by category". */
export const AMENITY_CATEGORY_ALL = "all";

/**
 * The combining marks NFKD decomposition separates out. Matched as an explicit
 * escape range so the pattern survives any re-encoding of this file.
 */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/**
 * Fold text to a comparison key: NFKD-decomposed, combining marks removed,
 * lowercased, and stripped of everything that is not a letter or digit.
 *
 * Used for the "does this already exist?" warning, where the question is
 * whether two labels denote the same facility, not whether their punctuation
 * agrees. "Kids' Club", "Kids Club" and "kids-club" all fold to "kidsclub".
 */
function comparisonKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Suggest a kebab-case slug for a newly created amenity from its display name.
 *
 * The result must satisfy the same `^[a-z0-9]+(-[a-z0-9]+)*$` pattern the
 * migration enforces, so a suggestion is never a slug the save would refuse.
 * Diacritics are decomposed and their combining marks dropped rather than
 * transliterated ("Café" → "cafe"), because a slug is a stable URL-safe key,
 * not a rendering of the name.
 *
 * This is a SUGGESTION only. The Owner may replace it entirely; the editor
 * stops overwriting the field as soon as it has been touched.
 */
export function suggestAmenitySlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/** Total, stable comparator over catalogue rows: category, then name, then slug. */
function byCatalogueOrder(
  left: StudioAmenityCatalogueEntry,
  right: StudioAmenityCatalogueEntry,
): number {
  return (
    left.category.localeCompare(right.category, "en") ||
    left.name.localeCompare(right.name, "en") ||
    left.slug.localeCompare(right.slug, "en")
  );
}

/**
 * The catalogue rows a search box and category filter should offer.
 *
 * `search` matches a case-insensitive substring of EITHER the display name or
 * the slug. Both, because the two are the two ways an Owner recognises an
 * amenity: "pool" finds "Swimming Pool" by name, and a slug pasted from an
 * existing project finds its row exactly. A blank or whitespace-only search
 * matches everything rather than nothing — an empty box is not a filter.
 *
 * `category` is an exact match, since the values come from the catalogue
 * itself (see catalogueCategories) and are not free text. Blank or the
 * sentinel `"all"` matches every row.
 *
 * The result is sorted by (category, name, slug) — the same total order the
 * database projection uses — so the picker never reshuffles between renders.
 */
export function filterCatalogue(
  entries: readonly StudioAmenityCatalogueEntry[],
  filters: { search?: string; category?: string },
): StudioAmenityCatalogueEntry[] {
  const search = (filters.search ?? "").trim().toLowerCase();
  const category = (filters.category ?? "").trim();
  const filterByCategory = category !== "" && category !== AMENITY_CATEGORY_ALL;

  return entries
    .filter((entry) => {
      if (filterByCategory && entry.category !== category) return false;
      if (search === "") return true;
      return entry.name.toLowerCase().includes(search) || entry.slug.toLowerCase().includes(search);
    })
    .sort(byCatalogueOrder);
}

/**
 * The distinct categories present in the catalogue, sorted.
 *
 * Derived from the rows rather than from `STUDIO_AMENITY_CATEGORIES`, and the
 * distinction matters. That constant is the closed vocabulary a NEW amenity must
 * be created with; this filter has to offer what the catalogue actually
 * CONTAINS, which includes rows written before the vocabulary existed and rows
 * whose category is blank or legacy. Offering the nine canonical values here
 * would hide every such row behind a filter that never matches it.
 *
 * Blank categories are dropped from the menu — an uncategorised amenity is
 * still reachable through search and through the "all" option, and an empty
 * entry in a filter menu is an unexplained option.
 */
export function catalogueCategories(entries: readonly StudioAmenityCatalogueEntry[]): string[] {
  const categories = new Set<string>();
  for (const entry of entries) {
    const category = entry.category.trim();
    if (category) categories.add(category);
  }
  return [...categories].sort((left, right) => left.localeCompare(right, "en"));
}

/**
 * How closely an existing catalogue row resembles a proposed new amenity.
 * Lower sorts first.
 *
 *   sameSlug  the slug is already taken — this one is fatal, not advisory;
 *   sameKey   a different slug but an identical folded name/slug: near-certain
 *             duplicate ("Kids' Club" against "kids-club");
 *   contained one folded key contains the other ("pool" against "lagoon-pool").
 */
const MATCH_RANK = { sameSlug: 0, sameKey: 1, contained: 2 } as const;

type MatchRank = (typeof MATCH_RANK)[keyof typeof MATCH_RANK];

/** Most close matches an Owner can act on before the warning becomes noise. */
const MAX_CLOSE_MATCHES = 5;

/**
 * Existing catalogue rows that may already be the amenity the Owner is about
 * to create.
 *
 * This exists to prevent the one failure the database cannot catch: a shared
 * catalogue slowly accumulating "Kids Club", "Kids' Club" and "kids-club-pool"
 * as three separate amenities, after which no project's list can be compared
 * with another's. The migration rejects an exact slug collision outright
 * (`studio_amenity_slug_exists`); everything softer than that is a judgement
 * only the Owner can make, so it is surfaced as a warning and never as a block.
 *
 * Ranking, most similar first:
 *
 *   1. the candidate slug is already taken (this one is fatal, not advisory);
 *   2. the folded name or slug is identical to an existing row's;
 *   3. either folded key contains the other.
 *
 * Ties break on the smaller length difference, then name, then slug, so the
 * list is total and stable. At most five are returned.
 */
export function closeMatches(
  entries: readonly StudioAmenityCatalogueEntry[],
  candidate: { name: string; slug: string },
): StudioAmenityCatalogueEntry[] {
  const candidateSlug = candidate.slug.trim();
  // Blank keys are dropped rather than compared: "" is a substring of every
  // string, so keeping one would make every catalogue row a "close match".
  const candidateKeys = [comparisonKey(candidateSlug), comparisonKey(candidate.name)].filter(
    (key) => key !== "",
  );
  if (candidateSlug === "" && candidateKeys.length === 0) return [];

  const ranked: Array<{ entry: StudioAmenityCatalogueEntry; rank: MatchRank; gap: number }> = [];

  for (const entry of entries) {
    if (candidateSlug !== "" && entry.slug === candidateSlug) {
      ranked.push({ entry, rank: MATCH_RANK.sameSlug, gap: 0 });
      continue;
    }
    const entryKeys = [comparisonKey(entry.slug), comparisonKey(entry.name)].filter(
      (key) => key !== "",
    );
    let best: { rank: MatchRank; gap: number } | null = null;
    for (const entryKey of entryKeys) {
      for (const candidateKey of candidateKeys) {
        const rank: MatchRank | null =
          entryKey === candidateKey
            ? MATCH_RANK.sameKey
            : entryKey.includes(candidateKey) || candidateKey.includes(entryKey)
              ? MATCH_RANK.contained
              : null;
        if (rank === null) continue;
        const gap = Math.abs(entryKey.length - candidateKey.length);
        if (!best || rank < best.rank || (rank === best.rank && gap < best.gap)) {
          best = { rank, gap };
        }
      }
    }
    if (best) ranked.push({ entry, rank: best.rank, gap: best.gap });
  }

  return ranked
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.gap - right.gap ||
        left.entry.name.localeCompare(right.entry.name, "en") ||
        left.entry.slug.localeCompare(right.entry.slug, "en"),
    )
    .slice(0, MAX_CLOSE_MATCHES)
    .map((match) => match.entry);
}

/** How many of the selected amenities are featured (compare with the limit). */
export function featuredCount(selected: readonly StudioProjectAmenity[]): number {
  return selected.reduce((count, entry) => count + (entry.isFeatured ? 1 : 0), 0);
}

/** True when featuring one more amenity would exceed the product ceiling. */
export function featuredLimitReached(selected: readonly StudioProjectAmenity[]): boolean {
  return featuredCount(selected) >= STUDIO_MAX_FEATURED_AMENITIES;
}

/**
 * Renumber `sort_order` as 10, 20, 30… WITHIN each of the two groups,
 * preserving the array's current order.
 *
 * Per group, not across the whole list, because the public projection sorts by
 * `is_featured` first and `sort_order` only within a group — a single sequence
 * spanning both would encode an order the reader never applies, and would
 * change every non-featured row's number the moment one row above it was
 * featured.
 *
 * The array order is preserved exactly. This function assigns numbers; it
 * never moves anything (see reorder and displayOrder for that).
 */
export function normalizeSortOrders(
  selected: readonly StudioProjectAmenity[],
): StudioProjectAmenity[] {
  let featured = 0;
  let regular = 0;
  return selected.map((entry) => {
    const position = entry.isFeatured ? (featured += 1) : (regular += 1);
    return { ...entry, sortOrder: position * AMENITY_SORT_STEP };
  });
}

/**
 * Put the selection into the order the public page will actually render:
 * featured first, then `sortOrder`, then category, name, slug.
 *
 * A deliberate mirror of `mapProjectAmenities` in
 * `@/features/project-detail/project-detail-mappers`. The editor applies it
 * after any change that can move an amenity between groups so that what the
 * Owner is looking at IS the published order — an editor that showed a
 * different order than it saves would be lying about the outcome. The
 * comparator is total, so equal `sortOrder` values (every row on a project
 * that has never been ordered) still yield one stable order.
 */
export function displayOrder(selected: readonly StudioProjectAmenity[]): StudioProjectAmenity[] {
  return [...selected].sort(
    (left, right) =>
      Number(right.isFeatured) - Number(left.isFeatured) ||
      left.sortOrder - right.sortOrder ||
      left.category.localeCompare(right.category, "en") ||
      left.name.localeCompare(right.name, "en") ||
      left.slug.localeCompare(right.slug, "en"),
  );
}

/**
 * Move one amenity one place up or down WITHIN ITS OWN GROUP, then renumber.
 *
 * The swap partner is the nearest entry in the same featured/non-featured
 * group, which need not be adjacent in the array. That keeps the operation
 * meaningful in the only order the reader sees: nudging a non-featured amenity
 * up must move it past the previous non-featured one, never past a featured
 * one it can never outrank.
 *
 * At a group boundary — the first featured row asked to go up, the last
 * non-featured row asked to go down — and for an unknown slug, nothing moves.
 * A fresh, renumbered array is still returned, so the caller can assign the
 * result to state unconditionally without ever mutating its input.
 */
export function reorder(
  selected: readonly StudioProjectAmenity[],
  slug: string,
  direction: "up" | "down",
): StudioProjectAmenity[] {
  const next = [...selected];
  const index = next.findIndex((entry) => entry.slug === slug);
  if (index < 0) return normalizeSortOrders(next);

  const step = direction === "up" ? -1 : 1;
  const group = next[index].isFeatured;
  let partner = index + step;
  while (partner >= 0 && partner < next.length && next[partner].isFeatured !== group) {
    partner += step;
  }
  if (partner < 0 || partner >= next.length) return normalizeSortOrders(next);

  [next[index], next[partner]] = [next[partner], next[index]];
  return normalizeSortOrders(next);
}

/**
 * Project the selection onto the EXACT set `studio_save_project_amenities`
 * expects as `p_amenities`.
 *
 * "Exact set" is the whole contract: the function reconciles a project's
 * amenities to precisely this array, deleting every link absent from it. There
 * is no partial or additive form, so this must be built from the complete
 * local selection and never from a diff.
 *
 * A pure projection — snake_case keys, nothing trimmed, nothing defaulted. The
 * function trims the note and re-validates every field itself, and the state
 * it returns is what the editor re-hydrates from, so normalising here as well
 * would only invent a second place for the two to disagree.
 */
export function toSavePayload(selected: readonly StudioProjectAmenity[]): Array<{
  amenity_slug: string;
  note: string;
  is_featured: boolean;
  sort_order: number;
}> {
  return selected.map((entry) => ({
    amenity_slug: entry.slug,
    note: entry.note,
    is_featured: entry.isFeatured,
    sort_order: entry.sortOrder,
  }));
}
