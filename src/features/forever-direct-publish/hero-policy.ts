/**
 * Semantic hero policy (FOREVER-HERO-SELECTION-AND-CORRECTION-001).
 *
 * A project cover has one job: show, immediately, what property is being
 * offered. The previous rule could not do that, because it never asked what an
 * image contained. It honoured any filename carrying `cover` or `hero`, and
 * otherwise took the largest file. On real developer material that reliably
 * picks the wrong thing: a launch-party group photograph is the biggest file in
 * the set, a seasonal advertising banner is the biggest render, and the first
 * file a folder happens to list is a materials wall in the sales gallery.
 *
 * So selection is now semantic. Every candidate is assigned one role from a
 * small fixed vocabulary using the evidence actually available to a program —
 * the source section it came from, its filename, the category the shared
 * classifier already derived, its pixel geometry and its bytes-per-pixel — and
 * only roles that depict the property may become the cover.
 *
 * Three properties matter more than cleverness here:
 *
 *   1. **A prohibited role is never overridable.** Not by a filename, not by an
 *      explicit package preference, not by being the largest or sharpest file.
 *      An Owner-supplied `hero.jpg` that is a group photograph stays rejected.
 *   2. **Silence beats a misleading cover.** When nothing depicts the property,
 *      the project publishes with no hero and a stated exception, rather than
 *      showing a photograph of something else.
 *   3. **The same inputs always give the same cover.** Ranking is a total order
 *      over stated evidence, ending in the content hash, so no run depends on
 *      the order a filesystem or archive happened to enumerate entries.
 *
 * This module is pure: no I/O, no decoding, no network. It reads bytes only
 * through the size and geometry the caller already computed.
 */

import type { IntakeCategory } from "../../intake/types";

/**
 * The role vocabulary.
 *
 * Deliberately small — one term per decision the policy actually makes. Finer
 * distinctions (which amenity, which room) would not change any outcome, and
 * every extra term is another way for two classifiers to disagree.
 */
export const SEMANTIC_ROLES = [
  "property_exterior",
  "property_aerial",
  "property_pool_exterior",
  "villa_exterior",
  "architecture_render",
  "property_interior",
  "amenity",
  "landscape",
  "lifestyle",
  "event",
  "group_photo",
  "portrait",
  "decorative_detail",
  "text_promo",
  "plan",
  "map",
  "unknown",
] as const;

export type SemanticRole = (typeof SEMANTIC_ROLES)[number];

/**
 * How a role may be used as a cover.
 *
 * `last_resort` exists for one honest reason: a source set that carries no
 * structure at all (a flat folder of `IMG_0001.jpg`) yields no evidence either
 * way, and refusing every such project a cover would be a worse outcome than
 * the behaviour being replaced. What the policy refuses is a cover that is
 * *known* to depict something else — never one that is merely undescribed.
 */
export type HeroEligibility = "eligible" | "fallback" | "last_resort" | "prohibited";

const ELIGIBILITY: Record<SemanticRole, HeroEligibility> = {
  property_exterior: "eligible",
  property_aerial: "eligible",
  property_pool_exterior: "eligible",
  villa_exterior: "eligible",
  architecture_render: "eligible",
  property_interior: "fallback",
  unknown: "last_resort",
  amenity: "prohibited",
  landscape: "prohibited",
  lifestyle: "prohibited",
  event: "prohibited",
  group_photo: "prohibited",
  portrait: "prohibited",
  decorative_detail: "prohibited",
  text_promo: "prohibited",
  plan: "prohibited",
  map: "prohibited",
};

/**
 * Role priority, highest first — the Owner's stated preference order.
 *
 * Clear exterior, then render, then aerial, then pool-with-buildings, then
 * villa facade. Interior and undescribed sit below every one of them and are
 * only reachable when nothing above exists.
 */
const ROLE_PRIORITY: Record<SemanticRole, number> = {
  property_exterior: 100,
  architecture_render: 95,
  property_aerial: 90,
  property_pool_exterior: 85,
  villa_exterior: 80,
  property_interior: 40,
  unknown: 10,
  amenity: 0,
  landscape: 0,
  lifestyle: 0,
  event: 0,
  group_photo: 0,
  portrait: 0,
  decorative_detail: 0,
  text_promo: 0,
  plan: 0,
  map: 0,
};

export function heroEligibility(role: SemanticRole): HeroEligibility {
  return ELIGIBILITY[role];
}

export function isHeroProhibited(role: SemanticRole): boolean {
  return ELIGIBILITY[role] === "prohibited";
}

// ---------------------------------------------------------------------------
// Evidence extraction
// ---------------------------------------------------------------------------

/**
 * Path separators.
 *
 * `__` is included because the local dossier convention flattens a folder tree
 * into a filename (`11. Perspective__Exterior__PET CLUB.jpg`). Treating those
 * as real segments is what lets one rule read both a Drive tree and its
 * flattened local mirror as the same evidence.
 */
function segmentsOf(path: string): string[] {
  return path
    .split(/[/\\]/)
    .flatMap((part) => part.split("__"))
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Lowercase, punctuation-free, single-spaced — safe for phrase matching. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokensOf(normalised: string): string[] {
  return normalised.split(" ").filter(Boolean);
}

/** Does this normalised text contain any of these words or phrases? */
function matches(normalised: string, phrases: readonly string[]): string | null {
  const padded = ` ${normalised} `;
  for (const phrase of phrases) {
    if (padded.includes(` ${phrase} `)) return phrase;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/** Occasions. A photograph of an occasion depicts people, not a building. */
const EVENT_TERMS = [
  "event",
  "events",
  "launch",
  "launching",
  "launch party",
  "opening",
  "grand opening",
  "ceremony",
  "ceremonies",
  "award",
  "awards",
  "party",
  "celebration",
  "celebrations",
  "anniversary",
  "press",
  "exhibition",
  "roadshow",
  "road show",
  "seminar",
  "booth",
] as const;

const GROUP_TERMS = [
  "group photo",
  "group photos",
  "team",
  "our team",
  "staff",
  "sales team",
  "employees",
  "crew",
  "delegation",
] as const;

const PORTRAIT_TERMS = ["portrait", "portraits", "headshot", "headshots", "profile photo"] as const;

/** Advertising and social-media material: made to sell a feeling, not a place. */
const LIFESTYLE_TERMS = [
  "lifestyle",
  "life style",
  "marketing material",
  "marketing materials",
  "advertising",
  "advertisement",
  "campaign",
  "promotion",
  "promotional",
  "promo",
  "social media",
  "instagram",
  "facebook",
  "tiktok",
  "reel",
  "reels",
  "holiday",
  "holidays",
  "christmas",
  "new year",
  "songkran",
  "valentine",
  "moment",
  "moments",
  "activity",
  "activities",
  "shopping",
  "dining",
  "food",
  "drink",
  "drinks",
  "beverage",
  "cocktail",
  "gift",
  "gifts",
  "couple",
  "couples",
  "photoshoot",
  "photo shoot",
] as const;

const DECOR_TERMS = [
  "material board",
  "mood board",
  "moodboard",
  "sample board",
  "swatch",
  "swatches",
  "decoration",
  "decorations",
  "decorative",
  "ornament",
  "flower",
  "flowers",
  "vase",
  "close up",
  "closeup",
  "detail shot",
] as const;

/** Text-led artwork: a wordmark, a banner, a key visual, a brochure cover. */
const TEXT_TERMS = [
  "wordmark",
  "banner",
  "poster",
  "key visual",
  "cover page",
  "title card",
  "price list",
  "pricelist",
  "factsheet",
  "fact sheet",
  "e brochure",
  "ebrochure",
] as const;

/**
 * Drawings, however they are filed.
 *
 * The shared classifier already routes the conventional folders, but a source
 * set can put a plan somewhere it does not recognise. Villa Kirara filed its
 * villa layouts under "5. House Plan", which read as photographs; one of those
 * sheets then matched "house" and was proposed as a villa exterior. A drawing
 * is a drawing whatever folder holds it, so this is checked before any
 * depiction term.
 */
const PLAN_TERMS = [
  "plan",
  "plans",
  "floor plan",
  "floorplan",
  "house plan",
  "unit plan",
  "master plan",
  "masterplan",
  "site plan",
  "siteplan",
  "layout plan",
  "typical floor",
  "elevation drawing",
  "section drawing",
  "blueprint",
] as const;

const MAP_TERMS = ["map", "maps", "location map", "site map", "sitemap", "vicinity"] as const;

const AERIAL_TERMS = [
  "aerial",
  "aerials",
  "drone",
  "bird eye",
  "birds eye",
  "bird s eye",
  "top view",
  "overview",
  "panorama",
  "panoramic",
  "sky view",
] as const;

const VILLA_TERMS = ["villa", "villas", "house", "houses", "bungalow", "mansion"] as const;

const POOL_TERMS = ["pool", "pools", "swimming", "lagoon", "waterscape"] as const;

/** An architectural subject: the building itself, or how one arrives at it. */
const EXTERIOR_TERMS = [
  "exterior",
  "exteriors",
  "facade",
  "facades",
  "elevation",
  "elevations",
  "entrance",
  "entry",
  "drop off",
  "dropoff",
  "arrival",
  "frontage",
  "streetscape",
  "street view",
  "building",
  "buildings",
  "tower",
  "towers",
  "block",
  "gate",
  "gateway",
] as const;

const RENDER_TERMS = [
  "perspective",
  "perspectives",
  "render",
  "renders",
  "rendering",
  "cgi",
  "3d",
  "visualisation",
  "visualization",
] as const;

const INTERIOR_TERMS = [
  "interior",
  "interiors",
  "show unit",
  "show units",
  "showunit",
  "show room",
  "showroom",
  "living room",
  "livingroom",
  "bedroom",
  "bedrooms",
  "bathroom",
  "bathrooms",
  "kitchen",
  "dining room",
  "wardrobe",
  "penthouse",
] as const;

const AMENITY_TERMS = [
  "gym",
  "fitness",
  "spa",
  "sauna",
  "steam room",
  "onzen",
  "onsen",
  "lounge",
  "clubhouse",
  "club house",
  "beach club",
  "co working",
  "coworking",
  "co living",
  "coliving",
  "kids",
  "kid s",
  "children",
  "playground",
  "pet",
  "pet club",
  "garden",
  "gardens",
  "shop",
  "shops",
  "retail",
  "restaurant",
  "cafe",
  "library",
  "games room",
  "game room",
  "bar",
  "reception",
  "lobby",
  "parking",
  "pavilion",
  "sala",
  "shuttle",
] as const;

const LANDSCAPE_TERMS = [
  "landscape",
  "sea view",
  "seaview",
  "ocean view",
  "mountain",
  "mountains",
  "sunset",
  "sunrise",
  "scenery",
  "nature",
] as const;

/** Filename tokens by which a package designates its own intended cover. */
const DESIGNATION_TOKENS: ReadonlySet<string> = new Set(["cover", "hero"]);

/**
 * Below this many bytes per pixel an image is flat artwork, not a photograph.
 *
 * A logo or a title card compresses to almost nothing because it is large areas
 * of constant colour; a photograph or an architectural render never approaches
 * this even at aggressive quality. It is the one signal that reliably separates
 * `SIERRA Logo-01.png` from `The Title Sierra_Drop Off_LOGO.png`, whose names
 * both contain the word "logo" — in the second it means "carries the
 * watermark", which no filename rule can tell apart on its own.
 */
const FLAT_ARTWORK_BYTES_PER_PIXEL = 0.04;

/**
 * A segment names a logo *asset* only when logo is all it says.
 *
 * `012_Logo/PNG` is a folder of logos. `PERSPECTIVE_WITH LOGO` is a folder of
 * renders that carry a watermark. The difference is whether anything else is
 * being named.
 */
function isLogoAssetSegment(normalised: string): boolean {
  const tokens = tokensOf(normalised).filter((token) => !/^\d+$/.test(token));
  if (tokens.length === 0) return false;
  const meaningful = tokens.filter((token) => token !== "png" && token !== "svg" && token !== "ai");
  return (
    meaningful.length > 0 && meaningful.every((token) => token === "logo" || token === "logos")
  );
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface HeroCandidateEvidence {
  /** Logical path inside the source. Classification input only, never shown. */
  path: string;
  /** Byte length of the file. */
  size: number;
  /** Declared pixel geometry, when the container states it. */
  width?: number | null;
  height?: number | null;
  /** Category the shared path classifier already derived, when known. */
  category?: IntakeCategory | null;
  /**
   * The project's own slug, so its words can be discounted as evidence.
   *
   * Every file in a project carries the project's name, so those words describe
   * nothing about any individual image. Villa Kirara made this concrete: a
   * generated package renames its photographs to
   * `the-title-villa-kirara-gallery-00.jpg`, the word "villa" matched, and 24
   * launch-party photographs were classified `villa_exterior` — reaching past
   * the role the Factory had recorded, because a path that mentions a villa
   * looks like evidence. It is not.
   */
  slug?: string | null;
  /**
   * Role the source package already recorded for this file.
   *
   * A generated package renames every file to `<slug>-gallery-07.jpg`, which
   * destroys the source folder and filename this policy reads. Without a
   * carried role, re-planning a finished package would classify everything as
   * `unknown` and could hand the cover to a launch-party photograph the Factory
   * had already rejected. So the Factory writes what it decided into the
   * manifest, and this is that value.
   *
   * It is consulted ONLY when the path itself yields no evidence. A declared
   * `property_exterior` can never launder a file sitting in an `Event` folder:
   * real evidence always wins over a declaration.
   */
  declaredRole?: SemanticRole | null;
}

export interface SemanticAssessment {
  role: SemanticRole;
  eligibility: HeroEligibility;
  /** One short public-safe phrase naming the evidence that decided the role. */
  reason: string;
  /** True when the depicted subject is outside the building. */
  exterior: boolean;
  /** True when the evidence says people are the subject. */
  peopleProminent: boolean;
  /** True when the evidence says text or flat artwork dominates. */
  textDominant: boolean;
  /** True when the filename designates this file as the intended cover. */
  designated: boolean;
}

const PEOPLE_ROLES: ReadonlySet<SemanticRole> = new Set([
  "event",
  "group_photo",
  "portrait",
  "lifestyle",
]);

const EXTERIOR_ROLES: ReadonlySet<SemanticRole> = new Set([
  "property_exterior",
  "property_aerial",
  "property_pool_exterior",
  "villa_exterior",
  "landscape",
]);

/** Categories the shared classifier already decided; never re-litigated here. */
function roleFromCategory(category: IntakeCategory | null | undefined): SemanticRole | null {
  switch (category) {
    case "master-plan":
    case "floor-plan":
    case "unit-plan":
    case "payment-plan":
      return "plan";
    case "map-location":
      return "map";
    case "brochure":
      return "text_promo";
    default:
      return null;
  }
}

/** A role a piece of text states outright, or null when it states none. */
function prohibitedRoleFromText(normalised: string): { role: SemanticRole; term: string } | null {
  const plan = matches(normalised, PLAN_TERMS);
  if (plan) return { role: "plan", term: plan };
  const map = matches(normalised, MAP_TERMS);
  if (map) return { role: "map", term: map };
  const event = matches(normalised, EVENT_TERMS);
  if (event) return { role: "event", term: event };
  const group = matches(normalised, GROUP_TERMS);
  if (group) return { role: "group_photo", term: group };
  const portrait = matches(normalised, PORTRAIT_TERMS);
  if (portrait) return { role: "portrait", term: portrait };
  const lifestyle = matches(normalised, LIFESTYLE_TERMS);
  if (lifestyle) return { role: "lifestyle", term: lifestyle };
  const decor = matches(normalised, DECOR_TERMS);
  if (decor) return { role: "decorative_detail", term: decor };
  const text = matches(normalised, TEXT_TERMS);
  if (text) return { role: "text_promo", term: text };
  return null;
}

/**
 * A depiction role a piece of text states, or null.
 *
 * Order is the whole rule. Aerial before everything, because an aerial of a
 * pool is still an aerial. Villa before pool, so a villa-and-pool render reads
 * as a villa. Pool before amenity, so "POOL BAR" is a pool with buildings
 * rather than a bar. Exterior before amenity, so "CLUBHOUSE & PARKING BUILDING"
 * is a building rather than a clubhouse. Interior before amenity, so a gym
 * interior is an interior. Amenity last, which is what makes "PET CLUB" and
 * "FOOT SPA & ONZEN IN THE GARDEN" ineligible while their sibling exteriors are
 * not — they sit in the same `Exterior` folder and only their own names
 * separate them.
 */
function depictionRoleFromText(normalised: string): { role: SemanticRole; term: string } | null {
  const aerial = matches(normalised, AERIAL_TERMS);
  if (aerial) return { role: "property_aerial", term: aerial };

  const villa = matches(normalised, VILLA_TERMS);
  const pool = matches(normalised, POOL_TERMS);
  const exterior = matches(normalised, EXTERIOR_TERMS);
  const interior = matches(normalised, INTERIOR_TERMS);

  if (villa && !interior) return { role: "villa_exterior", term: villa };
  if (pool && !interior) return { role: "property_pool_exterior", term: pool };
  if (exterior && !interior) return { role: "property_exterior", term: exterior };
  if (interior) return { role: "property_interior", term: interior };

  const amenity = matches(normalised, AMENITY_TERMS);
  if (amenity) return { role: "amenity", term: amenity };
  const landscape = matches(normalised, LANDSCAPE_TERMS);
  if (landscape) return { role: "landscape", term: landscape };

  const render = matches(normalised, RENDER_TERMS);
  if (render) return { role: "architecture_render", term: render };
  return null;
}

/**
 * Assign one semantic role to one candidate.
 *
 * Evidence is read in a fixed order of authority:
 *
 *   1. the category the shared classifier already derived (a master plan is a
 *      plan however it is named);
 *   2. flat-artwork geometry (a logo is a logo whatever folder it sits in);
 *   3. a prohibited role stated by the *section* — a photograph filed under
 *      "Photo in the Event" is event material regardless of what it is called,
 *      and this is the step a `hero`/`cover` filename cannot reach past;
 *   4. a role stated by the *filename*, which refines its section: exteriors
 *      and garden amenities share one folder and only their names differ;
 *   5. the section's own depiction role, when the filename says nothing;
 *   6. otherwise `unknown` — no evidence, not a judgement.
 */
export function classifySemanticRole(evidence: HeroCandidateEvidence): SemanticAssessment {
  const segments = segmentsOf(evidence.path);
  const nameSegment = segments.length > 0 ? segments[segments.length - 1] : evidence.path;
  const sectionSegments = segments.slice(0, -1);
  const projectWords = new Set(
    tokensOf(normalise(evidence.slug ?? "")).filter((token) => token.length >= 3),
  );
  const withoutProject = (text: string) =>
    tokensOf(text)
      .filter((token) => !projectWords.has(token))
      .join(" ");
  const name = withoutProject(normalise(nameSegment));
  const sections = sectionSegments.map((segment) => withoutProject(normalise(segment)));
  const sectionText = sections.join(" ");
  // The designation is read from the untouched name: a project slugged
  // "…-cover-…" is vanishingly unlikely, and stripping it would lose the one
  // signal a renamed package still carries.
  const designated = tokensOf(normalise(nameSegment)).some((token) =>
    DESIGNATION_TOKENS.has(token),
  );

  const decide = (role: SemanticRole, reason: string): SemanticAssessment => ({
    role,
    eligibility: ELIGIBILITY[role],
    reason,
    exterior: EXTERIOR_ROLES.has(role),
    peopleProminent: PEOPLE_ROLES.has(role),
    textDominant: role === "text_promo",
    designated,
  });

  const categoryRole = roleFromCategory(evidence.category);
  if (categoryRole) return decide(categoryRole, `classified as ${evidence.category}`);

  const pixels =
    evidence.width && evidence.height && evidence.width > 0 && evidence.height > 0
      ? evidence.width * evidence.height
      : null;
  if (pixels && evidence.size / pixels < FLAT_ARTWORK_BYTES_PER_PIXEL) {
    return decide("text_promo", "flat artwork, not a photograph");
  }
  if (sections.some(isLogoAssetSegment) || isLogoAssetSegment(name)) {
    return decide("text_promo", "filed as a logo asset");
  }

  for (const section of sections) {
    const prohibited = prohibitedRoleFromText(section);
    if (prohibited) return decide(prohibited.role, `source section states "${prohibited.term}"`);
  }

  const prohibitedByName = prohibitedRoleFromText(name);
  if (prohibitedByName) {
    return decide(prohibitedByName.role, `filename states "${prohibitedByName.term}"`);
  }

  const byName = depictionRoleFromText(name);
  if (byName) return decide(byName.role, `filename states "${byName.term}"`);

  const bySection = depictionRoleFromText(sectionText);
  if (bySection) return decide(bySection.role, `source section states "${bySection.term}"`);

  // Nothing in the path says anything. Only now does a role carried by the
  // package apply — it is the record of a richer classification made when the
  // original source folders and filenames still existed.
  if (evidence.declaredRole && SEMANTIC_ROLES.includes(evidence.declaredRole)) {
    return decide(evidence.declaredRole, "role recorded by the source package");
  }

  return decide("unknown", "no section or filename evidence");
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Whether the candidate names an architectural subject rather than inheriting
 * its role from a folder — the computable stand-in for "how much of the project
 * this image actually shows".
 *
 * `Coralina Entrance` names the arrival view of the development. `Coralina 1`
 * only inherits `Exterior` from its folder. `CLUBHOUSE & PARKING BUILDING`
 * names a building, but a single one of them. Ranking them in that order is
 * what makes the chosen cover the establishing shot rather than a detail of the
 * same quality.
 */
const SUB_FACILITY_TERMS = [
  "clubhouse",
  "club house",
  "parking",
  "shop",
  "shops",
  "retail",
  "lobby",
  "gym",
  "fitness",
  "spa",
  "sauna",
  "bar",
  "cafe",
  "restaurant",
  "playground",
  "pet",
  "kids",
  "library",
  "pavilion",
  "reception",
] as const;

function subjectScore(path: string): number {
  const segments = segmentsOf(path);
  const name = normalise(segments.length > 0 ? segments[segments.length - 1] : path);
  let score = 1;
  if (matches(name, EXTERIOR_TERMS) || matches(name, AERIAL_TERMS)) score = 3;
  if (matches(name, SUB_FACILITY_TERMS)) score -= 1;
  return score;
}

/**
 * A cover is cropped wide almost everywhere it is shown. Between 1.3:1 and
 * 2.2:1 survives that crop; a square or a portrait does not.
 */
function aspectScore(width: number | null | undefined, height: number | null | undefined): number {
  if (!width || !height || height <= 0) return 0;
  const ratio = width / height;
  if (ratio >= 1.3 && ratio <= 2.2) return 2;
  if (ratio > 1.0 && ratio < 1.3) return 1;
  return 0;
}

export interface HeroCandidate extends HeroCandidateEvidence {
  /** Stable content hash — the final, total tie-break. */
  sha256: string;
}

export interface RankedHeroCandidate {
  candidate: HeroCandidate;
  assessment: SemanticAssessment;
  /** Rank key, highest first. Reported so a choice can be explained. */
  score: number;
}

const TIER_RANK: Record<HeroEligibility, number> = {
  eligible: 3,
  fallback: 2,
  last_resort: 1,
  prohibited: 0,
};

/**
 * Total order over hero candidates, highest first.
 *
 * Tier, then the Owner's tie-break sequence: semantic role priority, exterior
 * coverage, useful horizontal aspect, effective resolution, and finally the
 * content hash so the order is total and independent of enumeration order.
 * Byte size is deliberately absent: the defect being fixed is precisely that a
 * file won for being big.
 */
function compareCandidates(a: RankedHeroCandidate, b: RankedHeroCandidate): number {
  const tier = TIER_RANK[b.assessment.eligibility] - TIER_RANK[a.assessment.eligibility];
  if (tier !== 0) return tier;

  // A package that names its own cover has already made the editorial choice
  // among candidates this policy would accept, so it decides — but only inside
  // its tier. It can never lift a candidate out of a lower tier and never
  // reaches a prohibited role, because those are filtered out before ranking.
  // This is also what survives packaging: a generated package's files are all
  // renamed, and `<slug>-cover.jpg` is the only trace of the choice left.
  const designated = Number(b.assessment.designated) - Number(a.assessment.designated);
  if (designated !== 0) return designated;

  const role = ROLE_PRIORITY[b.assessment.role] - ROLE_PRIORITY[a.assessment.role];
  if (role !== 0) return role;

  const subject = subjectScore(b.candidate.path) - subjectScore(a.candidate.path);
  if (subject !== 0) return subject;

  const aspect =
    aspectScore(b.candidate.width, b.candidate.height) -
    aspectScore(a.candidate.width, a.candidate.height);
  if (aspect !== 0) return aspect;

  const pixels =
    (b.candidate.width ?? 0) * (b.candidate.height ?? 0) -
    (a.candidate.width ?? 0) * (a.candidate.height ?? 0);
  if (pixels !== 0) return pixels;

  return a.candidate.sha256 < b.candidate.sha256
    ? -1
    : a.candidate.sha256 > b.candidate.sha256
      ? 1
      : 0;
}

/** Assess and rank every candidate. Pure, total and stable. */
export function rankHeroCandidates(candidates: readonly HeroCandidate[]): RankedHeroCandidate[] {
  return candidates
    .map((candidate) => {
      const assessment = classifySemanticRole(candidate);
      return {
        candidate,
        assessment,
        score:
          TIER_RANK[assessment.eligibility] * 10_000 +
          ROLE_PRIORITY[assessment.role] * 10 +
          subjectScore(candidate.path),
      };
    })
    .sort(compareCandidates);
}

export type HeroRejectionCode =
  | "prohibited_semantic_role"
  | "not_in_candidate_set"
  | "no_eligible_candidate";

export interface HeroSelection {
  /** The chosen cover, or null when nothing may be one. */
  hero: HeroCandidate | null;
  assessment: SemanticAssessment | null;
  /** Every candidate, ranked. Reporting and tests read this. */
  ranked: RankedHeroCandidate[];
  /** Set when an explicit preference was supplied and refused. */
  preferenceRejected: { path: string; code: HeroRejectionCode; detail: string } | null;
  /** Set when nothing was eligible. */
  missingReason: string | null;
}

export interface HeroSelectionOptions {
  /**
   * An explicit hero preference from the package or source set: the logical
   * path of the image the Owner wants as the cover.
   *
   * It is a preference, never an instruction. It must be a candidate in this
   * project's own set, it must already have passed sanitization and the
   * cross-project check to be here at all, and it must not name a prohibited
   * role — an Owner-chosen group photograph is still refused.
   */
  preferredPath?: string | null;
}

/**
 * Choose the cover for one project.
 *
 * Never throws and never blocks: a project with nothing depicting the property
 * returns `hero: null` and a stated reason, and publishes without a cover.
 */
export function selectHero(
  candidates: readonly HeroCandidate[],
  options: HeroSelectionOptions = {},
): HeroSelection {
  const ranked = rankHeroCandidates(candidates);
  const usable = ranked.filter((entry) => entry.assessment.eligibility !== "prohibited");

  let preferenceRejected: HeroSelection["preferenceRejected"] = null;
  const preferred = options.preferredPath?.trim();
  if (preferred) {
    const match = ranked.find((entry) => entry.candidate.path === preferred);
    if (!match) {
      preferenceRejected = {
        path: preferred,
        code: "not_in_candidate_set",
        detail: "the preferred image is not a publishable candidate of this project",
      };
    } else if (match.assessment.eligibility === "prohibited") {
      preferenceRejected = {
        path: preferred,
        code: "prohibited_semantic_role",
        detail: `the preferred image is ${match.assessment.role} (${match.assessment.reason})`,
      };
    } else {
      return {
        hero: match.candidate,
        assessment: match.assessment,
        ranked,
        preferenceRejected: null,
        missingReason: null,
      };
    }
  }

  if (usable.length === 0) {
    const seen = new Set(ranked.map((entry) => entry.assessment.role));
    return {
      hero: null,
      assessment: null,
      ranked,
      preferenceRejected,
      missingReason:
        ranked.length === 0
          ? "no publishable photograph was supplied"
          : `every supplied image depicts something other than the property (${[...seen].sort().join(", ")})`,
    };
  }

  const winner = usable[0];
  return {
    hero: winner.candidate,
    assessment: winner.assessment,
    ranked,
    preferenceRejected,
    missingReason: null,
  };
}
