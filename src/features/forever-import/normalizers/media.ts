/**
 * Forever Import — media normalizer.
 *
 * Turns a loosely-typed media record from a source into the canonical media
 * shape (minus the surrogate ids that binding assigns later). A media candidate
 * without a valid URL is not a media asset, so it normalizes to `undefined`.
 */

import type { ForeverMediaType } from "@/features/forever-database";

import { normalizeBoolean, normalizeNumber, normalizeString, normalizeUrl } from "./primitives";

/** Loosely-typed media as it arrives from a source, before normalization. */
export interface RawMediaInput {
  mediaType?: unknown;
  title?: unknown;
  url?: unknown;
  altText?: unknown;
  caption?: unknown;
  sortOrder?: unknown;
  isPublic?: unknown;
}

/**
 * Canonical media without ids.
 *
 * Binding later attaches `id` and `projectId` to produce a full
 * `ForeverMedia`; the normalizer is deliberately id-agnostic so it can run
 * before a project id is known.
 */
export interface NormalizedMedia {
  mediaType: ForeverMediaType;
  title: string;
  url: string;
  altText?: string;
  caption?: string;
  sortOrder: number;
  isPublic: boolean;
}

/** Classify a free-text media kind into the canonical {@link ForeverMediaType}. */
export function normalizeMediaType(value: unknown): ForeverMediaType {
  const v = normalizeString(value)?.toLowerCase();
  if (!v) return "other";
  if (v.includes("cover")) return "cover_image";
  if (v.includes("gallery")) return "gallery_image";
  if (v.includes("floor")) return "floor_plan_image";
  if (v.includes("master")) return "master_plan_image";
  if (v.includes("unit")) return "unit_plan_image";
  if (v.includes("video")) return "video";
  if (v.includes("image") || v.includes("photo") || v.includes("picture")) return "image";
  return "other";
}

/**
 * Normalize one media candidate.
 *
 * Returns `undefined` when the source carries no valid `http(s)` URL, since a
 * media asset is defined by the asset it points at. `sortOrder` defaults to 0
 * and `isPublic` to `true` when the source is silent.
 */
export function normalizeMedia(input: RawMediaInput): NormalizedMedia | undefined {
  const url = normalizeUrl(input.url);
  if (url === undefined) return undefined;

  const media: NormalizedMedia = {
    mediaType: normalizeMediaType(input.mediaType),
    title: normalizeString(input.title) ?? "",
    url,
    sortOrder: normalizeNumber(input.sortOrder) ?? 0,
    isPublic: normalizeBoolean(input.isPublic) ?? true,
  };

  const altText = normalizeString(input.altText);
  if (altText !== undefined) media.altText = altText;
  const caption = normalizeString(input.caption);
  if (caption !== undefined) media.caption = caption;

  return media;
}
