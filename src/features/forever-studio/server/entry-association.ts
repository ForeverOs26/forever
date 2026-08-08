/**
 * Forever Studio — can this archive entry safely be associated with the
 * project the Owner selected?
 *
 * THE PROBLEM THIS SOLVES
 * ----------------------
 * A developer's "Full Project Archive" is assembled by the developer, not by
 * Forever, and it routinely carries material for a DIFFERENT development. The
 * commonest case by far is show-unit photography: one showroom is photographed
 * once and the same folder ships inside every project's package, labelled with
 * the showroom's own location. Those photographs are real, official and
 * useful — and they are not photographs of this project.
 *
 * The filename classifier cannot catch this. A show-unit photograph is a `.jpg`
 * in a folder that says "Show Unit", so it classifies as `photo` and would go
 * straight into the project gallery. Nothing downstream would object, because
 * nothing downstream knows where the picture was taken.
 *
 * THE RULE, AND WHY IT IS THIS NARROW
 * -----------------------------------
 * An entry needs manual review when its path EXPLICITLY declares a showroom
 * location and that location shares no word with the project's own location.
 *
 * Every clause is load-bearing:
 *
 *   - "showroom" — the rule fires only inside a segment that says it is a show
 *     unit, show room, show suite, show villa, sales gallery or sales office.
 *     A `Perspective/Exterior` render is never touched;
 *   - "EXPLICITLY declares" — the location must be introduced by a location
 *     marker (`@`, `at`, a dash or a comma). `Show Unit 2 Bedroom` declares a
 *     layout, not a place, and must not be mistaken for one;
 *   - "shares no word" — a single shared word is enough to keep the entry.
 *     `Show Unit @Kamala` against `Kamala, Phuket` matches on `kamala`;
 *   - "the project's own location" — when the project has no known location the
 *     rule CANNOT fire. A conflict is a positive claim, and this module never
 *     makes one it cannot support.
 *
 * The outcome is deliberately conservative in one direction only: a flagged
 * entry is retained privately for a human to decide, never deleted and never
 * published. A missed conflict is a gallery photograph the Owner removes; a
 * false conflict would be an official photograph silently withheld. Both are
 * recoverable, and the rule is written to avoid the second.
 *
 * PURE. No I/O, no project knowledge beyond the location string it is handed,
 * and no hardcoded project, developer or place name anywhere.
 */

/**
 * Retained privately because it could not be tied to the selected project.
 *
 * Reported through the ordinary `retained_private` outcome — the material is
 * genuinely retained and genuinely private — with this code naming the reason,
 * so no new durable state and therefore no migration is required.
 */
export const MANUAL_REVIEW_LOCATION_CONFLICT = "manual_review_location_conflict";

/** Segments that announce themselves as a showroom rather than the project. */
const SHOWROOM_MARKER =
  /\b(show\s*-?\s*(?:unit|room|suite|villa|home|house)s?|showroom s?|show\s*flat s?|sales\s*(?:gallery|office|suite))\b/i;

/**
 * What introduces a PLACE after the marker.
 *
 * `@` is what developers actually write (`Show Unit @Bangtao`). The others are
 * the ordinary punctuations of "this thing, at that place". Bare adjacency is
 * deliberately NOT accepted, because `Show Unit 2 Bedroom` would otherwise
 * declare "2 Bedroom" to be a location.
 */
const LOCATION_INTRODUCER = /(?:@|\bat\b|[-–—,:])\s*([^@]*)$/i;

/** Words that carry no location meaning and must not create a false match. */
const LOCATION_STOPWORDS = new Set([
  "the",
  "and",
  "at",
  "in",
  "of",
  "project",
  "projects",
  "phase",
  "building",
  "tower",
  "unit",
  "units",
  "show",
  "showroom",
  "room",
  "sales",
  "gallery",
  "office",
]);

/**
 * Lower-cased alphabetic words of a location, with noise removed.
 *
 * Digits and short fragments are dropped: a location is a place name, and
 * keeping `1`, `2` or `br` would let a unit code match a town.
 */
export function locationTokens(value: string | null | undefined): Set<string> {
  const tokens = new Set<string>();
  if (typeof value !== "string") return tokens;
  for (const raw of value.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 3) continue;
    if (LOCATION_STOPWORDS.has(raw)) continue;
    tokens.add(raw);
  }
  return tokens;
}

/**
 * The showroom location a path explicitly declares, or null.
 *
 * Only the nearest declaring segment is consulted — a deeper folder is more
 * specific than its parent — and a segment that names a showroom without
 * naming a place declares nothing.
 */
export function declaredShowroomLocation(entryPath: string): string | null {
  const segments = entryPath.split("/").filter(Boolean);
  // Nearest segment first: `…/Show Unit @Bangtao/1BR M-31/x.jpg` should answer
  // from the segment that actually declares the place.
  for (const segment of [...segments].reverse()) {
    const marker = SHOWROOM_MARKER.exec(segment);
    if (!marker) continue;
    const after = segment.slice(marker.index + marker[0].length);
    const introduced = LOCATION_INTRODUCER.exec(after);
    if (!introduced) continue;
    const candidate = introduced[1].trim();
    // A declared place must still LOOK like a place: at least one real word
    // survives tokenization. `Show Unit - 2` declares nothing.
    if (locationTokens(candidate).size === 0) continue;
    return candidate;
  }
  return null;
}

export interface EntryAssociation {
  /** The showroom location the path declared, when it declared one. */
  declaredLocation: string | null;
  /** True when that declaration contradicts the project's own location. */
  needsManualReview: boolean;
}

/**
 * Decide whether one entry can be associated with the selected project.
 *
 * `projectLocation` is whatever the job knows: the location submitted with this
 * upload, the existing project's location, or both. An empty or unknown project
 * location always yields `needsManualReview: false` — see the module note.
 */
export function associateEntryWithProject(input: {
  entryPath: string;
  projectLocation: Iterable<string | null | undefined>;
}): EntryAssociation {
  const declaredLocation = declaredShowroomLocation(input.entryPath);
  if (!declaredLocation) return { declaredLocation: null, needsManualReview: false };

  const projectTokens = new Set<string>();
  for (const value of input.projectLocation) {
    for (const token of locationTokens(value)) projectTokens.add(token);
  }
  // Nothing to contradict: never claim a conflict this module cannot support.
  if (projectTokens.size === 0) return { declaredLocation, needsManualReview: false };

  for (const token of locationTokens(declaredLocation)) {
    if (projectTokens.has(token)) return { declaredLocation, needsManualReview: false };
  }
  return { declaredLocation, needsManualReview: true };
}
