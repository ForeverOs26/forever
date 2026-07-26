/**
 * Owner Direct Publish — automatic public media selection
 * (FOREVER-STUDIO-OWNER-DIRECT-PUBLISH-001, Phase 3).
 *
 * All Owner-supplied official developer images are approved for publication, so
 * there is no human image-approval step. What remains is deterministic
 * selection: decide which of the supplied files become the public hero, the
 * gallery, the master plan and the representative plans, in a stable order that
 * does not change between two runs over the same package.
 *
 * Three exclusions run before selection:
 *   - byte-identical duplicates (first occurrence by path order wins);
 *   - material belonging to a DIFFERENT project (cross-project contamination);
 *   - files that are not publishable media at all.
 *
 * This module is a pure planner: it hashes and classifies bytes but performs no
 * upload and no database write. Sanitization/verification of the actual public
 * derivative happens in the publish step through the existing media-truth
 * boundary, so an unsanitizable image is retained privately rather than
 * published.
 */

import { createHash } from "node:crypto";

import type { ProgressiveWarning } from "@/features/forever-ingestion/batch-types";
import { classifyPath } from "@/intake/classify";
import type { IntakeCategory } from "@/intake/types";

/** Default useful gallery size for one project page. */
export const DEFAULT_MAX_GALLERY = 20;
/** Plans are informative but should not crowd out the gallery. */
export const DEFAULT_MAX_FLOOR_PLANS = 6;

/**
 * Public media order. The hero is `cover`; everything else follows a fixed
 * group order so a project page reads the same way for every project.
 */
const MEDIA_TYPE_ORDER: readonly string[] = [
  "cover",
  "gallery",
  "master_plan",
  "floor_plan",
  "unit_plan",
  "payment_plan",
  "brochure",
  "video",
  "document",
];

/** project_media.media_type for a source category; null keeps it private. */
export function publicMediaTypeForCategory(category: IntakeCategory): string | null {
  switch (category) {
    case "photo":
      return "gallery";
    case "video":
      return "video";
    case "master-plan":
      return "master_plan";
    case "floor-plan":
      return "floor_plan";
    case "unit-plan":
      return "unit_plan";
    case "payment-plan":
      return "payment_plan";
    case "brochure":
      return "brochure";
    case "map-location":
      return "document";
    default:
      // price lists, legal documents, developer profiles, project facts,
      // furniture packages, archives and unknowns stay private evidence.
      return null;
  }
}

export interface SourceMediaCandidate {
  /** Logical path inside the source package. Classification input only. */
  path: string;
  bytes: Buffer;
}

export interface PlannedMediaItem {
  path: string;
  category: IntakeCategory;
  /** project_media.media_type this item will be written as. */
  mediaType: string;
  sha256: string;
  size: number;
  /** True for the single automatically selected hero image. */
  isHero: boolean;
  sortOrder: number;
}

export type MediaExclusionReason =
  | "duplicate_bytes"
  | "cross_project_material"
  | "not_publishable_media"
  | "gallery_limit"
  | "plan_limit";

export interface ExcludedMedia {
  path: string;
  reason: MediaExclusionReason;
  detail?: string;
}

export interface MediaPlan {
  hero: PlannedMediaItem | null;
  /** Ordered public media records, hero first. */
  items: PlannedMediaItem[];
  excluded: ExcludedMedia[];
  warnings: ProgressiveWarning[];
}

export interface MediaPlanOptions {
  /** Slug of the project being published. */
  slug: string;
  /**
   * Other known project slugs. A candidate whose path clearly belongs to one of
   * these is excluded as contamination rather than published on this project.
   */
  otherProjectSlugs?: readonly string[];
  maxGallery?: number;
  maxFloorPlans?: number;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Path tokens, lowercased, for contamination comparison. */
function pathTokens(path: string): string[] {
  return path
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Does this path belong to a different project?
 *
 * A foreign slug matches when every one of its meaningful tokens appears in the
 * path AND the target project's own distinctive tokens do not. Requiring the
 * full foreign token set keeps generic words ("the", "phuket", "villas") from
 * condemning a legitimate file.
 */
export function isCrossProjectMaterial(
  path: string,
  slug: string,
  otherProjectSlugs: readonly string[],
): string | null {
  const tokens = new Set(pathTokens(path));
  const ownTokens = pathTokens(slug).filter((token) => token.length >= 4);
  const ownPresent = ownTokens.some((token) => tokens.has(token));
  if (ownPresent) return null;

  for (const other of otherProjectSlugs) {
    if (other === slug) continue;
    const foreignTokens = pathTokens(other).filter((token) => token.length >= 4);
    if (foreignTokens.length === 0) continue;
    if (foreignTokens.every((token) => tokens.has(token))) return other;
  }
  return null;
}

/**
 * Pick the hero from the eligible gallery images. Deterministic and explainable:
 * the largest image wins (developer hero renders are the highest-resolution
 * asset in practice), ties broken by path so the choice is reproducible.
 */
function selectHeroIndex(gallery: PlannedMediaItem[]): number {
  let best = 0;
  for (let index = 1; index < gallery.length; index += 1) {
    const candidate = gallery[index];
    const incumbent = gallery[best];
    if (
      candidate.size > incumbent.size ||
      (candidate.size === incumbent.size && candidate.path < incumbent.path)
    ) {
      best = index;
    }
  }
  return best;
}

/**
 * Build the deterministic public media plan for one source package.
 *
 * Selection is total and needs no human input: every supplied official image
 * either becomes a public record, or is excluded for a stated reason that is
 * reported as a warning.
 */
export function planPublicMedia(
  candidates: readonly SourceMediaCandidate[],
  options: MediaPlanOptions,
): MediaPlan {
  const maxGallery = options.maxGallery ?? DEFAULT_MAX_GALLERY;
  const maxFloorPlans = options.maxFloorPlans ?? DEFAULT_MAX_FLOOR_PLANS;
  const otherSlugs = options.otherProjectSlugs ?? [];

  const excluded: ExcludedMedia[] = [];
  const warnings: ProgressiveWarning[] = [];
  const seenHashes = new Map<string, string>();

  // Stable input order: identical packages plan identically regardless of how
  // the filesystem or archive enumerated their entries.
  const ordered = [...candidates].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const byMediaType = new Map<string, PlannedMediaItem[]>();

  for (const candidate of ordered) {
    const category = classifyPath(candidate.path).category;
    const mediaType = publicMediaTypeForCategory(category);
    if (!mediaType) {
      excluded.push({
        path: candidate.path,
        reason: "not_publishable_media",
        detail: category,
      });
      continue;
    }

    const foreign = isCrossProjectMaterial(candidate.path, options.slug, otherSlugs);
    if (foreign) {
      excluded.push({ path: candidate.path, reason: "cross_project_material", detail: foreign });
      warnings.push({
        entity: "media",
        code: "cross_project_material_excluded",
        severity: "warning",
        message: `A file that appears to belong to "${foreign}" was excluded from this project's media.`,
      });
      continue;
    }

    const digest = sha256(candidate.bytes);
    const duplicateOf = seenHashes.get(digest);
    if (duplicateOf) {
      excluded.push({ path: candidate.path, reason: "duplicate_bytes", detail: duplicateOf });
      continue;
    }
    seenHashes.set(digest, candidate.path);

    const item: PlannedMediaItem = {
      path: candidate.path,
      category,
      mediaType,
      sha256: digest,
      size: candidate.bytes.length,
      isHero: false,
      sortOrder: 0,
    };
    const bucket = byMediaType.get(mediaType);
    if (bucket) bucket.push(item);
    else byMediaType.set(mediaType, [item]);
  }

  // Caps: keep the page useful without silently hiding the overflow.
  const gallery = byMediaType.get("gallery") ?? [];
  if (gallery.length > maxGallery) {
    for (const dropped of gallery.slice(maxGallery)) {
      excluded.push({ path: dropped.path, reason: "gallery_limit" });
    }
    warnings.push({
      entity: "media",
      code: "gallery_truncated",
      severity: "info",
      message: `${gallery.length} gallery images were supplied; the first ${maxGallery} were published.`,
    });
    byMediaType.set("gallery", gallery.slice(0, maxGallery));
  }

  for (const planType of ["floor_plan", "unit_plan"] as const) {
    const plans = byMediaType.get(planType) ?? [];
    if (plans.length > maxFloorPlans) {
      for (const dropped of plans.slice(maxFloorPlans)) {
        excluded.push({ path: dropped.path, reason: "plan_limit" });
      }
      warnings.push({
        entity: "media",
        code: "plans_truncated",
        severity: "info",
        message: `${plans.length} ${planType.replace("_", " ")} files were supplied; ${maxFloorPlans} representative plans were published.`,
      });
      byMediaType.set(planType, plans.slice(0, maxFloorPlans));
    }
  }

  // Hero: promote one gallery image to `cover`.
  let hero: PlannedMediaItem | null = null;
  const finalGallery = byMediaType.get("gallery") ?? [];
  if (finalGallery.length > 0) {
    const heroIndex = selectHeroIndex(finalGallery);
    hero = finalGallery[heroIndex];
    hero.isHero = true;
    hero.mediaType = "cover";
    finalGallery.splice(heroIndex, 1);
    byMediaType.set("cover", [hero]);
    byMediaType.set("gallery", finalGallery);
  } else {
    warnings.push({
      entity: "media",
      code: "hero_image_missing",
      severity: "info",
      message: "No publishable photograph was supplied, so the project has no hero image yet.",
    });
  }

  // Stable global order across groups, then a dense sort_order.
  const items: PlannedMediaItem[] = [];
  for (const mediaType of MEDIA_TYPE_ORDER) {
    for (const item of byMediaType.get(mediaType) ?? []) items.push(item);
  }
  items.forEach((item, index) => {
    item.sortOrder = index;
  });

  return { hero, items, excluded, warnings };
}
