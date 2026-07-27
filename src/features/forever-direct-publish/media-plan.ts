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

import type { ProgressiveWarning } from "../forever-ingestion/batch-types";
import { classifyPath } from "../../intake/classify";
import type { IntakeCategory } from "../../intake/types";
import {
  selectHero,
  type HeroCandidate,
  type SemanticAssessment,
  type SemanticRole,
} from "./hero-policy";
import { readImageDimensions } from "./image-geometry";

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
  /** Declared pixel geometry, when the container stated it. */
  width?: number | null;
  height?: number | null;
  /** What the semantic hero policy decided this image depicts. */
  semanticRole?: SemanticRole;
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

/** One line of the hero decision, for the Owner's report. */
export interface HeroConsideration {
  path: string;
  role: SemanticRole;
  eligibility: SemanticAssessment["eligibility"];
  reason: string;
  exterior: boolean;
  peopleProminent: boolean;
  textDominant: boolean;
  width: number | null;
  height: number | null;
  size: number;
  sha256: string;
  score: number;
}

export interface MediaPlan {
  hero: PlannedMediaItem | null;
  /** What the policy decided about the chosen hero. */
  heroAssessment: SemanticAssessment | null;
  /** Every gallery candidate the hero policy considered, best first. */
  heroConsidered: HeroConsideration[];
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
  /**
   * Explicit hero preference: the logical path of the image the package or
   * source set asks for. Honoured only when it passes the semantic gate.
   */
  preferredHeroPath?: string | null;
  /**
   * Semantic roles a generated package already recorded, keyed by its own
   * relative path. Consulted only where the path yields no evidence of its own.
   */
  declaredRoles?: ReadonlyMap<string, SemanticRole>;
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
 * Hero selection lives in `hero-policy.ts`.
 *
 * What used to be here honoured any filename containing `cover` or `hero` and
 * otherwise took the largest file. Both rules are gone: a filename is now only
 * a preference inside the weakest tier, and byte size decides nothing at all.
 */

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

    const geometry = readImageDimensions(candidate.bytes);
    const item: PlannedMediaItem = {
      path: candidate.path,
      category,
      mediaType,
      sha256: digest,
      size: candidate.bytes.length,
      isHero: false,
      sortOrder: 0,
      width: geometry?.width ?? null,
      height: geometry?.height ?? null,
    };
    const bucket = byMediaType.get(mediaType);
    if (bucket) bucket.push(item);
    else byMediaType.set(mediaType, [item]);
  }

  // Hero FIRST, from every eligible photograph.
  //
  // Order matters. The cap used to run first, so a project whose establishing
  // shot sorted past the 24th path could never be considered for its own cover
  // — Coralina's entrance render lost to a launch-party photograph exactly that
  // way. Choosing before truncating means the cap can only ever discard images
  // the policy already ranked below the ones it kept.
  const gallery = byMediaType.get("gallery") ?? [];
  const heroCandidates: HeroCandidate[] = gallery.map((item) => ({
    path: item.path,
    size: item.size,
    width: item.width ?? null,
    height: item.height ?? null,
    category: item.category,
    sha256: item.sha256,
    declaredRole: options.declaredRoles?.get(item.path) ?? null,
  }));
  const heroSelection = selectHero(heroCandidates, {
    preferredPath: options.preferredHeroPath ?? null,
  });
  const assessmentByPath = new Map(
    heroSelection.ranked.map((entry) => [entry.candidate.path, entry]),
  );
  for (const item of gallery) {
    item.semanticRole = assessmentByPath.get(item.path)?.assessment.role;
  }

  // Rank the gallery the same way, so the images a visitor sees first are the
  // ones that show the property and the cap keeps the best rather than the
  // alphabetically earliest.
  const rankedGallery = heroSelection.ranked
    .map((entry) => gallery.find((item) => item.path === entry.candidate.path)!)
    .filter(Boolean);

  // The cap counts the cover, exactly as it did before, so correcting a hero
  // never quietly publishes one more image than the project had.
  const keptGallery = rankedGallery.slice(0, maxGallery);
  if (rankedGallery.length > maxGallery) {
    for (const dropped of rankedGallery.slice(maxGallery)) {
      excluded.push({ path: dropped.path, reason: "gallery_limit" });
    }
    warnings.push({
      entity: "media",
      code: "gallery_truncated",
      severity: "info",
      message: `${rankedGallery.length} gallery images were supplied; the ${maxGallery} that best depict the project were published.`,
    });
  }
  byMediaType.set("gallery", keptGallery);

  let hero: PlannedMediaItem | null = null;
  if (heroSelection.hero) {
    // The hero is by construction the highest-ranked usable candidate, so it
    // always survives a cap of at least one.
    const chosen = keptGallery.find((item) => item.path === heroSelection.hero!.path);
    if (chosen) {
      chosen.isHero = true;
      chosen.mediaType = "cover";
      hero = chosen;
      byMediaType.set("cover", [chosen]);
      byMediaType.set(
        "gallery",
        keptGallery.filter((item) => item !== chosen),
      );
    }
  }

  if (heroSelection.preferenceRejected) {
    warnings.push({
      entity: "media",
      code: "hero_preference_rejected",
      severity: "warning",
      message:
        `The requested cover image was not used because ${heroSelection.preferenceRejected.detail}. ` +
        "A cover must depict the property.",
    });
  }

  if (!hero) {
    warnings.push({
      entity: "media",
      code: gallery.length === 0 ? "hero_image_missing" : "hero_candidate_missing",
      severity: gallery.length === 0 ? "info" : "warning",
      message:
        gallery.length === 0
          ? "No publishable photograph was supplied, so the project has no hero image yet."
          : `No supplied image depicts the property, so the project publishes without a cover rather than showing something else: ${heroSelection.missingReason}.`,
    });
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

  // Stable global order across groups, then a dense sort_order.
  const items: PlannedMediaItem[] = [];
  for (const mediaType of MEDIA_TYPE_ORDER) {
    for (const item of byMediaType.get(mediaType) ?? []) items.push(item);
  }
  items.forEach((item, index) => {
    item.sortOrder = index;
  });

  const heroConsidered: HeroConsideration[] = heroSelection.ranked.map((entry) => ({
    path: entry.candidate.path,
    role: entry.assessment.role,
    eligibility: entry.assessment.eligibility,
    reason: entry.assessment.reason,
    exterior: entry.assessment.exterior,
    peopleProminent: entry.assessment.peopleProminent,
    textDominant: entry.assessment.textDominant,
    width: entry.candidate.width ?? null,
    height: entry.candidate.height ?? null,
    size: entry.candidate.size,
    sha256: entry.candidate.sha256,
    score: entry.score,
  }));

  return {
    hero,
    heroAssessment: heroSelection.assessment,
    heroConsidered,
    items,
    excluded,
    warnings,
  };
}
