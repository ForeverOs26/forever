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
import type { DecisionProfile } from "./decision-profile";

export const NO_EXACT_MATCH_MESSAGE =
  "No exact match found — showing available projects for discussion";

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
  results: MatchResult[];
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

  // Within selected budget — needs a budget band AND a real starting price.
  // Modeva's null starting_price_thb (mapped to 0) yields no reason, honestly.
  if (
    profile.budgetCeilingTHB !== null &&
    project.startingPriceTHB > 0 &&
    project.startingPriceTHB <= profile.budgetCeilingTHB
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
 * Evaluate the whole catalogue. Every project is always returned so the guest or
 * employee can browse and select any of them; the flag and message drive only the
 * honest no-exact-match heading.
 */
export function evaluateCatalogue(
  profile: DecisionProfile,
  projects: Property[],
): CatalogueEvaluation {
  const results = projects.map((project) => ({
    project,
    reasons: evaluateMatch(profile, project),
  }));
  const hasSupportedMatch = results.some((result) => result.reasons.length > 0);

  return {
    results,
    hasSupportedMatch,
    noMatchMessage: hasSupportedMatch ? null : NO_EXACT_MATCH_MESSAGE,
  };
}
