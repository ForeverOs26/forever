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

import {
  GALLERY_EXCLUDED_ROLES,
  isGalleryEligibleRole,
} from "@/features/forever-direct-publish/hero-policy";

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
 * as `<img>` tiles, so this is not hypothetical.
 */
export const NEVER_PUBLIC_ROLES: ReadonlySet<string> = new Set([
  "event",
  "group_photo",
  "portrait",
  "lifestyle",
]);

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
  for (const row of rows) {
    if ((row.url ?? "").trim() !== target) continue;
    if (isRetiredMediaType(row.mediaType)) return true;
    if (!isGalleryEligibleRole(row.semanticRole)) return true;
  }
  return false;
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
