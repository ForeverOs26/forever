/**
 * Package Factory — automatic public media selection.
 *
 * The existing Direct Publish planner (`forever-direct-publish/media-plan.ts`)
 * already does the deterministic part: exact-duplicate removal, cross-project
 * exclusion, hero choice, group ordering and caps. This module supplies what a
 * *package builder* additionally needs, so the Owner never selects a file:
 *
 *   - drop AppleDouble `._*` and other junk before planning;
 *   - detect obvious near-duplicates (the same render exported twice at
 *     different quality) and keep the largest;
 *   - PRE-FLIGHT every candidate through the real sanitizer, so an image whose
 *     colour profile cannot be proven plain sRGB (Display P3) is excluded from
 *     the package here — with a stated reason — instead of failing at upload
 *     time. No colour conversion is ever attempted;
 *   - name every published file deterministically, so two runs over the same
 *     sources emit byte-identical package contents.
 */

import { createHash } from "node:crypto";

import { createPublicDerivative } from "../forever-studio/server/media-truth";
import {
  planPublicMedia,
  publicMediaTypeForCategory,
  type MediaPlan,
  type SourceMediaCandidate,
} from "../forever-direct-publish/media-plan";
import { detectSanitizableImageType } from "../forever-direct-publish/publish";
import { classifyPath } from "../../intake/classify";

import { isJunkFilename } from "./adapters";

/** Default useful gallery size for one project page. */
export const FACTORY_MAX_GALLERY = 24;
/** Enough plans to cover the real unit types without crowding the gallery. */
export const FACTORY_MAX_PLANS = 13;

export interface MediaCandidate {
  /** Logical path, used for classification. */
  path: string;
  /** Public-safe basename. */
  ref: string;
  bytes: Buffer;
}

export type MediaExclusionCode =
  | "junk_file"
  | "not_publishable_media"
  | "duplicate_bytes"
  | "near_duplicate"
  | "unsupported_format"
  | "unsupported_color_profile"
  | "unsanitizable"
  | "gallery_limit"
  | "plan_limit"
  | "cross_project_material";

export interface MediaExclusion {
  ref: string;
  code: MediaExclusionCode;
  detail?: string;
}

export interface SelectedMedia {
  /** Filename the builder writes into the package. */
  filename: string;
  /** project_media.media_type this file will be published as. */
  mediaType: string;
  bytes: Buffer;
  sha256: string;
  isHero: boolean;
  sortOrder: number;
  /** Public-safe reference to the source artifact. */
  sourceRef: string;
}

export interface MediaSelection {
  selected: SelectedMedia[];
  excluded: MediaExclusion[];
  /** Files retained privately rather than published (P3, PDFs, …). */
  retainedPrivate: string[];
  plan: MediaPlan | null;
}

/**
 * Near-duplicate digest.
 *
 * Deliberately cheap and format-agnostic: the declared pixel geometry plus a
 * coarse quantization of the byte length. Two exports of the same render at
 * different JPEG qualities share geometry and land in the same size bucket; two
 * genuinely different photographs almost never do. This only ever *demotes* a
 * candidate to "near duplicate" when a larger sibling exists, so a false
 * positive costs one gallery slot, never a wrong publication.
 */
export function nearDuplicateKey(bytes: Buffer): string | null {
  const dimensions = readImageDimensions(bytes);
  if (!dimensions) return null;
  const bucket = Math.round(Math.log2(Math.max(1, bytes.length)) * 2);
  return `${dimensions.width}x${dimensions.height}:${bucket}`;
}

/** Declared pixel dimensions from the container header. Null when unknown. */
export function readImageDimensions(bytes: Buffer): { width: number; height: number } | null {
  // PNG: IHDR at a fixed offset.
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  // JPEG: walk the marker chain to the first SOF.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = bytes.readUInt16BE(offset + 2);
      const isStartOfFrame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isStartOfFrame) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
    return null;
  }
  // WebP (VP8X / VP8L / VP8 simple lossy).
  if (
    bytes.length >= 30 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    const chunk = bytes.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width, height };
    }
    if (chunk === "VP8 " && bytes.length >= 30) {
      return {
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff,
      };
    }
  }
  return null;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Package folder per public media type.
 *
 * The generated package is read back by `readSourcePackage`, which re-derives
 * each file's category with `classifyPath`. Folder-name rules are evaluated
 * FIRST there and use a fixed vocabulary, so writing each file into its
 * conventional folder makes the round trip exact and independent of whatever
 * words a project's slug happens to contain. Naming by filename alone would
 * mean a project slugged "…-map-…" silently changed its own media types.
 */
export const PACKAGE_MEDIA_FOLDER: Record<string, string> = {
  cover: "images",
  gallery: "images",
  master_plan: "master-plan",
  floor_plan: "floor-plans",
  unit_plan: "unit-plan",
  payment_plan: "payment-plan",
  brochure: "brochure",
  // `map-location` is the only category the planner publishes as `document`.
  document: "maps",
};

/** Stable, descriptive package-relative path for a published media file. */
export function packageMediaFilename(
  slug: string,
  mediaType: string,
  index: number,
  extension: string,
): string {
  const folder = PACKAGE_MEDIA_FOLDER[mediaType] ?? "images";
  // "cover" in the basename is what designates the hero to the planner.
  const suffix =
    mediaType === "cover"
      ? "cover"
      : `${mediaType.replace(/_/g, "-")}-${String(index).padStart(2, "0")}`;
  return `${folder}/${slug}-${suffix}.${extension}`;
}

const EXTENSION_FOR_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface MediaSelectionOptions {
  slug: string;
  otherProjectSlugs?: readonly string[];
  maxGallery?: number;
  maxPlans?: number;
}

/**
 * Choose the public media set for one project.
 *
 * Never blocks: a project with no usable image publishes with no hero and a
 * non-blocking warning, exactly as the existing planner already decided.
 */
export function selectMedia(
  candidates: readonly MediaCandidate[],
  options: MediaSelectionOptions,
): MediaSelection {
  const excluded: MediaExclusion[] = [];
  const retainedPrivate: string[] = [];

  // 1. Junk and non-publishable categories go before anything is hashed.
  const publishable: MediaCandidate[] = [];
  for (const candidate of candidates) {
    if (isJunkFilename(candidate.path)) {
      excluded.push({ ref: candidate.ref, code: "junk_file" });
      continue;
    }
    const category = classifyPath(candidate.path).category;
    if (!publicMediaTypeForCategory(category)) {
      excluded.push({ ref: candidate.ref, code: "not_publishable_media", detail: category });
      retainedPrivate.push(candidate.ref);
      continue;
    }
    publishable.push(candidate);
  }

  // 2. The sanitizer decides publishability for real, before packaging.
  //    An image whose colour profile cannot be proven plain sRGB is retained
  //    privately with a stated reason; nothing is converted.
  const sanitized: MediaCandidate[] = [];
  for (const candidate of publishable) {
    const observed = detectSanitizableImageType(candidate.bytes);
    if (!observed) {
      excluded.push({ ref: candidate.ref, code: "unsupported_format" });
      retainedPrivate.push(candidate.ref);
      continue;
    }
    const digest = sha256(candidate.bytes);
    const derivative = createPublicDerivative({
      bytes: candidate.bytes,
      originalSha256: digest,
      originalSize: candidate.bytes.length,
      observedContentType: observed,
    });
    if (!derivative.eligible) {
      excluded.push({
        ref: candidate.ref,
        // A colour-managed image (Display P3) is NOT malformed: its pixels
        // simply cannot be re-interpreted as sRGB without a conversion this
        // lane deliberately never performs. It is retained, not repaired.
        code:
          derivative.reason === "color_profile_unsupported"
            ? "unsupported_color_profile"
            : "unsanitizable",
        detail: derivative.reason,
      });
      retainedPrivate.push(candidate.ref);
      continue;
    }
    sanitized.push(candidate);
  }

  // 3. Near-duplicates: keep the largest of each geometry/size bucket.
  const bestByKey = new Map<string, MediaCandidate>();
  const survivors: MediaCandidate[] = [];
  for (const candidate of sanitized) {
    const key = nearDuplicateKey(candidate.bytes);
    if (!key) {
      survivors.push(candidate);
      continue;
    }
    const incumbent = bestByKey.get(key);
    if (!incumbent) {
      bestByKey.set(key, candidate);
      continue;
    }
    const loser = candidate.bytes.length > incumbent.bytes.length ? incumbent : candidate;
    const winner = loser === incumbent ? candidate : incumbent;
    bestByKey.set(key, winner);
    excluded.push({ ref: loser.ref, code: "near_duplicate", detail: winner.ref });
  }
  survivors.push(...bestByKey.values());

  if (survivors.length === 0) {
    return { selected: [], excluded, retainedPrivate, plan: null };
  }

  // 4. The existing deterministic planner does the rest.
  const planCandidates: SourceMediaCandidate[] = survivors.map((candidate) => ({
    path: candidate.path,
    bytes: candidate.bytes,
  }));
  const plan = planPublicMedia(planCandidates, {
    slug: options.slug,
    otherProjectSlugs: options.otherProjectSlugs,
    maxGallery: options.maxGallery ?? FACTORY_MAX_GALLERY,
    maxFloorPlans: options.maxPlans ?? FACTORY_MAX_PLANS,
  });

  const byPath = new Map(survivors.map((candidate) => [candidate.path, candidate]));
  for (const exclusion of plan.excluded) {
    const candidate = byPath.get(exclusion.path);
    excluded.push({
      ref: candidate?.ref ?? exclusion.path.split("/").pop() ?? exclusion.path,
      code: exclusion.reason as MediaExclusionCode,
      detail: exclusion.detail,
    });
  }

  const perTypeIndex = new Map<string, number>();
  const selected: SelectedMedia[] = plan.items.map((item) => {
    const candidate = byPath.get(item.path)!;
    const index = perTypeIndex.get(item.mediaType) ?? 0;
    perTypeIndex.set(item.mediaType, index + 1);
    const contentType = detectSanitizableImageType(candidate.bytes) ?? "image/jpeg";
    const extension = EXTENSION_FOR_TYPE[contentType] ?? "jpg";
    return {
      filename: packageMediaFilename(options.slug, item.mediaType, index, extension),
      mediaType: item.mediaType,
      bytes: candidate.bytes,
      sha256: item.sha256,
      isHero: item.isHero,
      sortOrder: item.sortOrder,
      sourceRef: candidate.ref,
    };
  });

  return { selected, excluded, retainedPrivate, plan };
}
