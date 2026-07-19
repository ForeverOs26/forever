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

/**
 * Known "no data" sentinel strings that source records use in place of an
 * actual absent value (e.g. a mapper writing the literal text `"Not available"`
 * rather than `null`/`""`). Compared case- and whitespace-insensitively.
 */
const UNAVAILABLE_SENTINELS = new Set([
  "",
  "not available",
  "n/a",
  "na",
  "unknown",
  "unresolved",
  "none",
  "-",
  "--",
  "—",
  "–",
]);

function normalizeForSentinelCheck(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True for null/undefined and for any known "no data" sentinel string. */
export function isUnavailableValue(value: string | null | undefined): boolean {
  if (typeof value !== "string") return true;
  return UNAVAILABLE_SENTINELS.has(normalizeForSentinelCheck(value));
}

/**
 * The one reusable missing/unavailable-value guard for every matching
 * dimension. A value only counts as a usable fact when it is a non-sentinel
 * string — never a positive or negative signal when the underlying data is
 * genuinely absent, "Not available", "N/A", "Unknown", "Unresolved", "None",
 * or a bare dash/em dash.
 */
function hasFactualValue(value: string | null | undefined): value is string {
  return typeof value === "string" && !isUnavailableValue(value);
}

/**
 * Sign characters that disqualify a percentage token: any plus or any
 * minus/hyphen/dash variant (ASCII `+`/`-`, Unicode minus `−`, en/em dash,
 * figure dash, horizontal bar, non-breaking hyphen, and full-width / small
 * forms). A token carrying any of these immediately before its digits (with
 * optional whitespace) is treated as signed and rejected — a negative yield is
 * never read as its positive magnitude, and a range separator like `6%–8%`
 * produces a second, signed token that also trips the ambiguity guard below.
 */
const SIGN_CHARS = "+\\-\\u2010-\\u2015\\u2212\\uFE58\\uFE62\\uFE63\\uFF0B\\uFF0D";

/**
 * One percentage token: an optional (rejected) leading sign, optional
 * whitespace, a number, optional whitespace, and `%`. Global so we can count
 * every token in the string and reject anything but exactly one.
 */
const PERCENT_TOKEN = new RegExp(`([${SIGN_CHARS}])?\\s*(\\d+(?:\\.\\d+)?)\\s*%`, "g");

/**
 * Parses an actually usable, quantified positive yield percentage out of a
 * free-text rental-yield field, or `null` when the field is absent, a
 * sentinel, unparseable, zero, negative, signed, ambiguous, or out of range.
 *
 * Fail-closed rules — anything uncertain returns `null` and produces no reason:
 *   • the sentinel guard runs first (`Not available`, `N/A`, empty, …);
 *   • there must be exactly ONE percentage token (zero → no figure; two or
 *     more → an ambiguous range / list such as `6%–8%`, `6% to 8%`,
 *     `6% and 8%`);
 *   • the token must be UNSIGNED — any leading `+` or minus/dash sign
 *     (`-6%`, `− 6%`, `–6%`, `+6%`) is rejected, so a negative yield is never
 *     mistaken for its positive magnitude;
 *   • the value must be `> 0` and `<= 100` (rejects `0%` and implausible
 *     figures like `1000% guaranteed`).
 *
 * It never infers or invents a number; non-quantified promotional copy
 * ("Strong rental potential") returns `null` exactly like a sentinel.
 */
export function extractQuantifiedYieldPercent(value: string | null | undefined): number | null {
  if (!hasFactualValue(value)) return null;

  const tokens = [...value.matchAll(PERCENT_TOKEN)];
  if (tokens.length !== 1) return null; // no figure, or an ambiguous range/list

  const [, sign, digits] = tokens[0];
  if (sign) return null; // any signed value (negative or positive) is rejected

  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100) return null;
  return amount;
}

function hasQuantifiedPositiveYield(value: string | null | undefined): boolean {
  return extractQuantifiedYieldPercent(value) !== null;
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

  // Purchase goal supported by available project evidence — an investment
  // intent on the profile AND an actually usable, quantified positive rental
  // yield fact on the project record. A sentinel ("Not available", "N/A",
  // "Unknown", …), empty value, or non-quantified promotional text produces no
  // reason; we never fabricate or infer a yield.
  if (profile.wantsInvestment && hasQuantifiedPositiveYield(project.rentalYield)) {
    reasons.push({
      kind: "purpose_evidence",
      label: "Purchase goal supported by available project evidence",
    });
  }

  // Relevant source-backed location preference — only when NAV-001 has captured
  // a preferred area (it does not today) that matches the project's location,
  // and the project's location is an actual value, not a sentinel.
  if (profile.preferredAreas.length > 0 && hasFactualValue(project.location)) {
    const location = project.location.toLowerCase();
    if (profile.preferredAreas.some((area) => location.includes(area.toLowerCase()))) {
      reasons.push({
        kind: "location",
        label: `Relevant ${project.location} location preference`,
      });
    }
  }

  // Relevant property format — only when NAV-001 has captured a preferred
  // property type (it does not today) that matches the project's type. This is
  // a typed enum with no "Not available" sentinel variant, so no sentinel guard
  // is needed here — the equality check alone is exact.
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
