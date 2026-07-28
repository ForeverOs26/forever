/**
 * One presentation policy for every public project image
 * (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001).
 *
 * The first version of this contract lived inside the Project Detail mapper,
 * which meant it protected exactly one surface. A catalogue card, a Discovery
 * result, an Open Graph tag and a JSON-LD `image` all read the same rows
 * through different code and were unprotected — so the same launch-party
 * photograph the project page had learned to hide was still the picture the
 * site handed to a search engine. A contract that holds on one reader is not a
 * contract; it is a coincidence. Every public reader now asks this module.
 *
 * Three rules, and each exists because the alternative failed:
 *
 *   1. **A retired cover is never presentation media.** `superseded_cover`
 *      records that an image *used to* represent the project. It is history,
 *      kept so a correction is auditable and the storage object is never
 *      orphaned. Any reader that decides what to show from an allow-list of
 *      media types keeps it out for free; any reader that decides from a
 *      deny-list would have to remember it, and one day would not. So the check
 *      is here, stated once, and asked by name.
 *
 *   2. **A prohibited role is never a public image.** Exclusion needs positive,
 *      recognised evidence — see `isGalleryEligibleRole`. That is what makes the
 *      pre-backfill rollout safe: today every published row has
 *      `semantic_role = NULL`, which means "nothing is known", which means
 *      "show it". Excluding on absence would have blanked the whole site on the
 *      first deploy.
 *
 *   3. **Nothing is inferred from a URL, a filename or a slug.** A role is read
 *      from the row that records it, never guessed from the text of the link.
 *      `presentableCoverUrl` does compare URLs — but as a *join key* onto the
 *      project's own recorded media, to find the role that was written down for
 *      that exact image. It never reads meaning out of the string itself. The
 *      difference matters: guessing from a filename is the defect this whole
 *      contract exists to remove.
 *
 * What this module deliberately does NOT do is invent a replacement image. When
 * nothing is presentable the answer is nothing, and the surface renders its own
 * neutral empty state. A gallery that quietly falls back to the media it was
 * built to exclude is worse than an empty one, because it is wrong *and* it
 * claims to be right.
 */

// Relative, not `@/features/…`, and deliberately so. jiti does not resolve
// tsconfig path aliases, so with the alias this module could not be loaded by a
// `.mjs` runner at all — and the semantic backfill has to ask THIS policy what
// its proposed roles would do to each page before it writes one. The
// alternative was a second copy of the presentation rule inside the runner,
// which is how a backfill ends up disagreeing with the reader it is meant to
// satisfy. Behaviour is identical; only the specifier changed.
import {
  GALLERY_EXCLUDED_ROLES,
  isGalleryEligibleRole,
} from "../features/forever-direct-publish/hero-policy";

export { GALLERY_EXCLUDED_ROLES, isGalleryEligibleRole };

/**
 * The `media_type` values that are photographs of the project.
 *
 * An allow-list, not a deny-list. A media type this build has never heard of is
 * not shown as a photograph, so a future `superseded_hero` or `internal_proof`
 * cannot become a picture on a page that predates it.
 */
export const PHOTOGRAPH_MEDIA_TYPES: ReadonlySet<string> = new Set(["cover", "gallery"]);

/**
 * The `media_type` values that record a past presentation decision.
 *
 * Retained rows, never shown. Listed explicitly — rather than relied upon to
 * fall outside `PHOTOGRAPH_MEDIA_TYPES` — so that a reader which must use a
 * deny-list has one to use, and so that the exclusion is greppable.
 */
export const RETIRED_MEDIA_TYPES: ReadonlySet<string> = new Set(["superseded_cover"]);

/** Whether a `media_type` names retained history rather than publishable media. */
export function isRetiredMediaType(mediaType: string | null | undefined): boolean {
  return RETIRED_MEDIA_TYPES.has((mediaType ?? "").trim());
}

/**
 * Roles that must never reach a public surface in ANY section.
 *
 * The gallery deny-list and this one answer different questions, and conflating
 * them breaks a section either way.
 *
 * `GALLERY_EXCLUDED_ROLES` also contains `plan`, `map` and `text_promo` — and
 * those are exactly the roles the publish lane assigns to a project's plans, its
 * location map and its brochure, by construction: `roleFromCategory` in
 * `hero-policy.ts` maps the `floor-plan`/`master-plan`/`unit-plan` categories to
 * `plan`, `map-location` to `map`, and `brochure` to `text_promo`. Applying the
 * gallery list to the Documents section would therefore delete every plan, every
 * map and every brochure Forever publishes. Those roles are wrong *among the
 * photographs*; in their own sections they are what the row is.
 *
 * What is left is material whose subject is people. A launch party is not a
 * floor plan, a staff group shot is not a location map, and a portrait is not a
 * brochure — so a row claiming to be one of those while recording one of these
 * roles is misfiled, and rendering it is the same defect the gallery contract
 * exists to prevent. `ProjectFloorPlans` and `ProjectLocation` render their rows
 * as `<img>` tiles, so a misfiled row is a launch party on the project page,
 * reached through a section the gallery contract never covered.
 *
 * Honest about its reach. Owner Direct Publish classifies each file from its own
 * source structure and now records a role for plans and documents as well as
 * photographs, so it will not normally file a launch party as a floor plan. This
 * is the floor for every OTHER writer — Studio, a manual correction, a future
 * lane — and for a source package whose folders lie. Defence in depth, not the
 * primary defence.
 */
export const NEVER_PUBLIC_ROLES: ReadonlySet<string> = new Set([
  "event",
  "group_photo",
  "portrait",
  "lifestyle",
]);

/**
 * `decorative_detail` is deliberately absent, and that is a judgement rather
 * than an oversight.
 *
 * Subtracting plans, maps and brochures from `GALLERY_EXCLUDED_ROLES` leaves
 * five roles, not four. The fifth is `decorative_detail` — a fabric swatch, a
 * material board, a close-up of an ornament. It has no business among the
 * photographs, which is why the gallery excludes it. But a material board filed
 * as a document is a document a buyer may genuinely want, and unlike a launch
 * party it is at least *about* the property. Excluding it everywhere would
 * delete a legitimate specification sheet to prevent nothing.
 */

/** The minimum a caller must know about a row to ask this policy about it. */
export interface PublicMediaCandidate {
  /** `project_media.media_type`, or the synthesised type of a project column. */
  mediaType: string;
  /** `project_media.semantic_role`; `null` for a row that predates the contract. */
  semanticRole?: string | null;
}

/**
 * May this row be shown as a photograph of the project, on any public surface?
 *
 * The single question every reader asks. It is deliberately one function rather
 * than a pair of checks each caller composes: the two Sierra and Coralina
 * defects were both a caller that remembered one half.
 */
export function isPublicPhotograph(candidate: PublicMediaCandidate): boolean {
  const mediaType = (candidate.mediaType ?? "").trim();
  if (isRetiredMediaType(mediaType)) return false;
  if (!PHOTOGRAPH_MEDIA_TYPES.has(mediaType)) return false;
  return isGalleryEligibleRole(candidate.semanticRole);
}

/**
 * May this row appear at all — in any section, as a picture or as a link?
 *
 * The floor beneath every other rule here. A row that fails this is not moved to
 * a different section; it is not public. Retired rows fail it, and so does any
 * row whose recorded subject is people.
 *
 * Deliberately weaker than `isPublicPhotograph`: a plan must pass this and must
 * NOT pass that.
 */
export function isPubliclyPresentable(candidate: PublicMediaCandidate): boolean {
  if (isRetiredMediaType(candidate.mediaType)) return false;
  const role = (candidate.semanticRole ?? "").trim();
  if (!role) return true;
  return !NEVER_PUBLIC_ROLES.has(role);
}

/** A recorded `project_media` row, in the shape this policy needs. */
export interface RecordedMedia extends PublicMediaCandidate {
  url: string;
}

/**
 * The role recorded for one exact URL, or `undefined` when no row records it.
 *
 * A URL can legitimately appear on more than one row of a project — the cover
 * and its gallery entry are the same image. Where the rows disagree the
 * strictest recorded answer wins, because a public surface has to be right
 * about the worst case, not the most convenient one.
 */
function isAnyRecordedRowUnpresentable(url: string, rows: readonly RecordedMedia[]): boolean {
  const target = url.trim();
  if (!target) return false;
  let sawRow = false;
  let everyRowRetired = true;
  for (const row of rows) {
    if ((row.url ?? "").trim() !== target) continue;
    sawRow = true;
    if (!isRetiredMediaType(row.mediaType)) everyRowRetired = false;
    if (!isGalleryEligibleRole(row.semanticRole)) return true;
  }
  // A URL whose ONLY row is a retired cover means the column is stale — it names
  // a designation that has been withdrawn and nothing live replaces it. A URL
  // that also has a live row is a different thing: a demoted cover that is still
  // a perfectly good photograph keeps its gallery entry, and the column pointing
  // at it is not wrong, merely redundant.
  return sawRow && everyRowRetired;
}

/**
 * URLs this project may not show as a photograph, on any surface.
 *
 * The rule is per-URL, not per-row, and that distinction is the whole point.
 *
 * A re-published project holds the same URL as BOTH a `cover` row and a
 * `gallery` row — the migration's own reasoning for choosing `superseded_cover`
 * over `gallery` says so explicitly. So a per-row filter lets a prohibited image
 * back in through its sibling: `presentableCoverUrl` refuses Sierra's
 * "HOLIDAY MOMENTS" because the `cover` row records `text_promo`, the
 * still-role-less `gallery` row for the identical URL passes on its own terms,
 * and `hero: cover ?? gallery[0]` hands the page the graphic anyway. The cover
 * check would have been theatre.
 *
 * So: if ANY row records a prohibited role for a URL, that URL is prohibited
 * everywhere, whatever its other rows say. The strictest recorded answer wins,
 * and it wins for the whole URL rather than for one row of it.
 *
 * Retirement is deliberately NOT part of this. `superseded_cover` withdraws a
 * *designation*, not an image: Coralina's previous cover is a fine exterior
 * photograph and belongs in the gallery it was promoted out of. What removes a
 * prohibited image is its role. Nothing else ever did.
 */
export function prohibitedPhotographUrls(rows: readonly RecordedMedia[]): ReadonlySet<string> {
  const barred = new Set<string>();
  for (const row of rows) {
    const url = (row.url ?? "").trim();
    if (!url) continue;
    if (!isGalleryEligibleRole(row.semanticRole)) barred.add(url);
  }
  return barred;
}

/**
 * URLs that may not appear in ANY section — the same per-URL rule applied to the
 * floor. A launch-party photograph filed once as a plan is a launch-party
 * photograph however many other rows call it something else.
 */
export function neverPublicUrls(rows: readonly RecordedMedia[]): ReadonlySet<string> {
  const barred = new Set<string>();
  for (const row of rows) {
    const url = (row.url ?? "").trim();
    const role = (row.semanticRole ?? "").trim();
    if (url && role && NEVER_PUBLIC_ROLES.has(role)) barred.add(url);
  }
  return barred;
}

/**
 * The project's own cover URL, when it may be shown — otherwise `null`.
 *
 * `projects.main_image_url` is a bare column. It carries no role of its own, so
 * on its own terms it always looks safe, and that is exactly how Sierra's
 * "HOLIDAY MOMENTS" graphic and Coralina's launch-event photograph stayed on
 * the site: they were the *cover*, and the cover was the one image nothing
 * filtered.
 *
 * The role that describes that image does exist — on the project's own
 * `project_media` row for the same URL. So the column is resolved against those
 * rows before it is shown. This is a join on a recorded identifier, not
 * classification of a string: the decision still comes from a role somebody
 * wrote down.
 *
 * Returning `null` is a complete answer. The caller shows its neutral empty
 * state; it does not go looking for another picture.
 */
export function presentableCoverUrl(
  mainImageUrl: string | null | undefined,
  rows: readonly RecordedMedia[],
): string | null {
  const url = (mainImageUrl ?? "").trim();
  if (!url) return null;
  if (isAnyRecordedRowUnpresentable(url, rows)) return null;
  return url;
}
