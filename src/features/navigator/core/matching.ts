/**
 * Deterministic project-matching evaluator.
 *
 * One shared evaluator for both website and booth. Identical answers + identical
 * project data always produce an identical result in either mode, because both
 * call these same pure functions.
 *
 * Hard rules (NAV-001 §09):
 *   • No score, percentage, ranking, "best project", fabricated yield, market
 *     position, verification status, or trust score is ever computed or shown.
 *   • A factual reason is emitted only when BOTH the confirmed profile and the
 *     project record contain the supporting fact. Missing information on either
 *     side produces no reason — never a positive or negative signal.
 *   • When no project earns a supported reason, the honest no-exact-match
 *     fallback line is used and the full real catalogue is still shown.
 */

import type { Property } from "@/lib/data";
import type { CurrencyCode, DecisionProfile } from "./decision-profile";

export const NO_EXACT_MATCH_MESSAGE =
  "No exact match found — showing available projects for discussion";

/** The canonical currency of `Property.startingPriceTHB`. */
export const PROJECT_PRICE_CURRENCY: CurrencyCode = "THB";

export type MatchReasonKind = "budget" | "purpose_evidence" | "location" | "property_format";

export interface MatchReason {
  kind: MatchReasonKind;
  label: string;
}

export interface MatchResult {
  project: Property;
  reasons: MatchReason[];
}

export interface CatalogueEvaluation {
  /** Projects with at least one supported factual reason, in catalogue order. */
  matchedResults: MatchResult[];
  /** The complete available catalogue, in catalogue order. */
  allResults: MatchResult[];
  /** True when at least one project earned a supported factual reason. */
  hasSupportedMatch: boolean;
  /** The heading fallback line to show when no supported match exists. */
  noMatchMessage: string | null;
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Evaluate one project against the confirmed profile. Returns only reasons that
 * are backed by structured data present on both sides. An absent profile field
 * or an absent project fact yields no reason for that dimension.
 */
export function evaluateMatch(profile: DecisionProfile, project: Property): MatchReason[] {
  const reasons: MatchReason[] = [];

  // Within selected budget — needs a stated budget ceiling AND a real project
  // price expressed in the SAME canonical currency. NAV-001 bands are USD and
  // `startingPriceTHB` is THB; no exchange rate is invented here, so across
  // incomparable currencies this reason is unavailable. That is missing
  // comparable currency data, never a negative match. A future canonical
  // currency-normalized ceiling (currency "THB") lights this up in both modes
  // with no shell change. Modeva's null starting_price_thb (mapped to 0)
  // likewise yields no reason, honestly.
  if (
    profile.budgetCeiling !== null &&
    profile.budgetCeiling.currency === PROJECT_PRICE_CURRENCY &&
    project.startingPriceTHB > 0 &&
    project.startingPriceTHB <= profile.budgetCeiling.amount
  ) {
    reasons.push({ kind: "budget", label: "Within selected budget" });
  }

  // Purchase goal supported by available project evidence — an investment intent
  // on the profile AND a rental-yield fact present on the project record. We do
  // not fabricate a yield; we only note that the record carries the evidence.
  if (profile.wantsInvestment && nonEmpty(project.rentalYield)) {
    reasons.push({
      kind: "purpose_evidence",
      label: "Purchase goal supported by available project evidence",
    });
  }

  // Relevant source-backed location preference — only when NAV-001 has captured
  // a preferred area (it does not today) that matches the project's location.
  if (profile.preferredAreas.length > 0 && nonEmpty(project.location)) {
    const location = project.location.toLowerCase();
    if (profile.preferredAreas.some((area) => location.includes(area.toLowerCase()))) {
      reasons.push({
        kind: "location",
        label: `Relevant ${project.location} location preference`,
      });
    }
  }

  // Relevant property format — only when NAV-001 has captured a preferred
  // property type (it does not today) that matches the project's type.
  if (
    profile.preferredPropertyTypes.length > 0 &&
    profile.preferredPropertyTypes.includes(project.propertyType)
  ) {
    reasons.push({ kind: "property_format", label: "Relevant property format" });
  }

  return reasons;
}

/**
 * Evaluate the whole catalogue — the single result engine for BOTH shells.
 *
 * `allResults` always carries the complete catalogue so the guest or employee
 * can browse and select any project; `matchedResults` is the subset with at
 * least one supported factual reason. Catalogue order is preserved exactly as
 * ProjectService delivers it (featured first, then creation order) — matched
 * projects are never re-ranked by any invented score.
 */
export function evaluateCatalogue(
  profile: DecisionProfile,
  projects: Property[],
): CatalogueEvaluation {
  const allResults = projects.map((project) => ({
    project,
    reasons: evaluateMatch(profile, project),
  }));
  const matchedResults = allResults.filter((result) => result.reasons.length > 0);
  const hasSupportedMatch = matchedResults.length > 0;

  return {
    matchedResults,
    allResults,
    hasSupportedMatch,
    noMatchMessage: hasSupportedMatch ? null : NO_EXACT_MATCH_MESSAGE,
  };
}

/**
 * Shared presentation rule for which results a shell displays:
 *   • supported matches exist → `matchedResults`;
 *   • "Browse all projects"   → `allResults`;
 *   • no supported match      → `allResults` (under the honest fallback line).
 * Both shells route through this one function so their visible project sets can
 * never diverge for identical answers and catalogue data.
 */
export function visibleResults(
  evaluation: CatalogueEvaluation,
  browseAll: boolean,
): MatchResult[] {
  if (browseAll || !evaluation.hasSupportedMatch) return evaluation.allResults;
  return evaluation.matchedResults;
}
