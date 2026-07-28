/**
 * Choosing one role for one URL
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * ONE ROLE PER URL, not per row. Sierra's active cover
 * `37fa558ae05e339e3bdf1dc6.png` is a single URL holding two production rows —
 * `cover` at sort_order 0 and `gallery` at sort_order 8 — and
 * `prohibitedPhotographUrls` bars a URL if ANY of its rows records a
 * non-gallery-eligible role. Give those two rows different roles and Sierra
 * loses its hero. So the decision is made once, for the URL, and fanned out.
 *
 * Three rules decide it, in this order.
 *
 *   **A superseded package may only hide, never reveal.** The pre-fix hero run
 *   is the only local artifact that declares a role for the images the corrected
 *   Factory later dropped, so discarding it wholesale would leave Coralina's
 *   launch-party photographs unclassified and public. It is also demonstrably
 *   wrong elsewhere: the same run declared `villa_exterior` for two Villa Kirara
 *   "House Plan" sheets, because the packaging renames files to
 *   `the-title-villa-kirara-gallery-NN.jpg` and the word "villa" matched. Both
 *   facts are true at once, and the resolution is asymmetric trust — a
 *   superseded manifest is believed when it says "hide this" and refused when it
 *   says "show this". A wrong hide costs one image; a wrong reveal is a launch
 *   party on the front page.
 *
 *   **Higher authority wins, and inside one authority the stricter role wins.**
 *   Not the more common one, not the first one: two pieces of equally-authorised
 *   evidence disagreeing about an image means we do not know what it is, and the
 *   safe answer to "we do not know" is the one that shows less.
 *
 *   **`unknown` is never written.** It is inside the vocabulary and it is
 *   gallery-eligible, so writing it makes the after-backfill gate pass while
 *   asserting nothing. Replaying the planner over the pre-contract packages
 *   yields `unknown` for 23 Coralina, 17 Sierra and 10 Modeva photographs,
 *   including Coralina's launch-party cover — a backfill that wrote those would
 *   report a clean sheet and leave the defect exactly where it was. A URL that
 *   resolves to `unknown` resolves to nothing, and becomes a written exception.
 *
 * Pure: no I/O, no clock.
 */

import {
  GALLERY_ELIGIBILITY,
  heroEligibility,
  SEMANTIC_ROLES,
  type SemanticRole,
} from "../forever-direct-publish/hero-policy";
import { NEVER_PUBLIC_ROLES } from "../../lib/public-media-policy";
import type { ConflictRecord, EvidenceCandidate, EvidenceTier } from "./types";

/**
 * How much a role hides, lowest number = hides the most.
 *
 * Derived from the real policy maps rather than listed here, so a change to
 * `NEVER_PUBLIC_ROLES` or `GALLERY_ELIGIBILITY` moves this ordering with it. A
 * hand-maintained duplicate of the bands is the thing that would quietly stop
 * agreeing with the reader.
 */
export function strictnessBand(role: SemanticRole): 0 | 1 | 2 | 3 | 4 | 5 {
  if (NEVER_PUBLIC_ROLES.has(role)) return 0;
  if (!GALLERY_ELIGIBILITY[role]) return 1;
  const eligibility = heroEligibility(role);
  if (eligibility === "prohibited") return 2;
  if (eligibility === "last_resort") return 3;
  if (eligibility === "fallback") return 4;
  return 5;
}

/**
 * Evidence authority, highest first.
 *
 * A role the Factory recorded beats a role re-derived from a path, because the
 * recording was made while the original folders still existed and the path may
 * be a renamed package file. A content-hash join into the local source tree
 * beats a folder convention, because it identifies the actual original. The
 * planner's geometry rule — flat artwork is not a photograph — sits below all
 * of them: it is a true statement about bytes, not about subject matter.
 *
 * `extracted_manifest_source_inventory` sits directly under
 * `package_manifest_source_path` because it is the same claim reached the same
 * way: it names the section-bearing original path recorded for THIS object,
 * addressed by the object's own derivative hash. It ranks below only because it
 * needs two recorded tables to agree rather than one field, and above the
 * source-tree hash and the folder convention because those recover a path for
 * bytes that merely match, or infer from where a packager filed a copy.
 *
 * `superseded_package_manifest` is last, and constrained further below.
 */
export const TIER_ORDER: readonly EvidenceTier[] = [
  "package_manifest_semantic_role",
  "package_manifest_source_path",
  "extracted_manifest_source_inventory",
  "local_source_tree_content_hash",
  "package_folder_convention",
  "planner_geometry_rule",
  "superseded_package_manifest",
  "none",
];

export interface RoleDecision {
  /** `null` means nothing was established — including when `unknown` won. */
  role: SemanticRole | null;
  winner: EvidenceCandidate | null;
  losers: EvidenceCandidate[];
  conflict: ConflictRecord | null;
  /** True when a superseded package supplied the winning role. */
  restrictiveOverride: boolean;
  refusedCandidates: Array<{ candidate: EvidenceCandidate; why: string }>;
}

const ROLE_INDEX = new Map<SemanticRole, number>(
  SEMANTIC_ROLES.map((role, index) => [role, index]),
);

export function resolveRoleForUrl(candidates: readonly EvidenceCandidate[]): RoleDecision {
  const refusedCandidates: Array<{ candidate: EvidenceCandidate; why: string }> = [];
  const surviving: EvidenceCandidate[] = [];

  for (const candidate of candidates) {
    // 1a. `unknown` is dropped before anything is ranked, not after.
    //
    //     It has to be. Its strictness band (3) sits BELOW `property_interior`
    //     (4), so leaving it in the ranking would let "we could not tell" beat
    //     a role the classifier actually established — the strictest-wins rule
    //     reading an absence of evidence as evidence. Dropping it here means a
    //     URL resolves to `unknown` only when `unknown` is all there was, which
    //     is the case that correctly becomes a written exception.
    if (candidate.role === "unknown") {
      refusedCandidates.push({ candidate, why: "classifier_returned_unknown" });
      continue;
    }
    // 1b. Hide-only rule. A superseded manifest that would put an image BACK on
    //     a public surface (band 2 and above: amenity, landscape, interior and
    //     every hero-eligible exterior) is refused outright. Villa Kirara's two
    //     "House Plan" sheets are exactly this case.
    if (candidate.tier === "superseded_package_manifest" && strictnessBand(candidate.role) >= 2) {
      refusedCandidates.push({ candidate, why: "superseded_manifest_may_only_hide" });
      continue;
    }
    surviving.push(candidate);
  }

  if (surviving.length === 0) {
    return {
      role: null,
      winner: null,
      losers: [],
      conflict: null,
      restrictiveOverride: false,
      refusedCandidates,
    };
  }

  // 2. Highest non-empty authority.
  const topTier = TIER_ORDER.find((tier) => surviving.some((c) => c.tier === tier));
  const inTier = surviving.filter((candidate) => candidate.tier === topTier);

  // 3./4. Strictest role wins; a tie inside one band falls to vocabulary order,
  //       which is fixed and reviewable rather than dependent on input order.
  const ranked = [...inTier].sort((a, b) => {
    const band = strictnessBand(a.role) - strictnessBand(b.role);
    if (band !== 0) return band;
    return (ROLE_INDEX.get(a.role) ?? 99) - (ROLE_INDEX.get(b.role) ?? 99);
  });
  const winner = ranked[0];
  const losers = surviving.filter((candidate) => candidate !== winner);

  const disagreeing = losers.filter((candidate) => candidate.role !== winner.role);
  const conflict: ConflictRecord | null =
    disagreeing.length > 0
      ? {
          winning_role: winner.role,
          winning_tier: winner.tier,
          losing: disagreeing.map((candidate) => ({
            role: candidate.role,
            tier: candidate.tier,
            input: candidate.input,
            input_value: candidate.inputValue,
          })),
          resolution:
            inTier.length > 1 &&
            ranked[1] &&
            strictnessBand(ranked[1].role) === strictnessBand(winner.role)
              ? "same tier, same strictness band — vocabulary order decided it"
              : inTier.length > 1
                ? "same tier — the role that shows less won"
                : "a higher-authority tier decided it",
        }
      : null;

  return {
    role: winner.role,
    winner,
    losers,
    conflict,
    restrictiveOverride: winner.tier === "superseded_package_manifest",
    refusedCandidates,
  };
}

/**
 * Does this decision need a human to look at it before the run?
 *
 * A conflict resolved to a role that removes the image from a public surface is
 * a content deletion decided by disagreeing evidence. It still happens — the
 * strict answer is the safe one — but it is listed in `review_required` so the
 * Owner sees it as a deletion rather than as a row in a table of 409.
 */
export function needsReview(decision: RoleDecision): boolean {
  if (!decision.conflict || !decision.role) return false;
  return strictnessBand(decision.role) <= 1;
}
