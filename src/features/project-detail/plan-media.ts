/**
 * Renderability of plan media (F-008 / F-025).
 *
 * A plan section is a claim: "this project has layouts you can look at". The
 * heading must therefore follow the items, not the other way round. Two rules
 * hold everywhere plans are rendered:
 *
 * 1. **A section with nothing to show does not render.** No empty heading, no
 *    empty container. `/projects/the-title-serenity` and `/projects/modeva`
 *    both printed "Available layouts" while holding no unit plan at all.
 * 2. **A record without a usable URL is not an item.** An entry whose `url` is
 *    blank, or is neither absolute nor root-relative, cannot open or draw, so
 *    counting it would reintroduce the empty section through the back door.
 *
 * What this module deliberately does not do is reclassify anything. Floor
 * plans, unit plans and the master plan are selected purely by their recorded
 * `media_type` in `groupProjectMedia`, so a master plan can never surface as a
 * unit layout and a site plan can never surface as a floor plan. Where a
 * source asset looks miscategorised — the Legendary "Floor plan 1" tile whose
 * artwork is captioned MASTER PLAN (F-029) — that is a question about the
 * stored record and needs a human eye on the source, not a guess in the UI.
 */
import type { ProjectDetailMediaItem } from "./project-detail-types";
import { publicBrowserUrl } from "./public-url";

/** A URL the browser can actually open: absolute http(s), or root-relative. */
export function isRenderableMediaUrl(url: string | null | undefined): boolean {
  return Boolean(publicBrowserUrl(url));
}

/** The subset of a plan collection that can actually be displayed. */
export function renderablePlans(
  items: readonly ProjectDetailMediaItem[] | null | undefined,
): ProjectDetailMediaItem[] {
  return (items ?? []).filter((item) => isRenderableMediaUrl(item?.url));
}

/** A single plan record, or null when it cannot be displayed. */
export function renderablePlan(
  item: ProjectDetailMediaItem | null | undefined,
): ProjectDetailMediaItem | null {
  return item && isRenderableMediaUrl(item.url) ? item : null;
}
