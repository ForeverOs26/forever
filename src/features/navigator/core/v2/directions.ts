/**
 * Initial-directions evaluator (Booth Mode 2.0).
 *
 * Replaces "projects matching your preferences" with truthful "initial
 * directions based on what we know". The same NAV-001 §09 hard rules apply and
 * are extended to the Search Essentials:
 *
 *   • No score, percentage, ranking, "best match", fabricated yield, or hidden
 *     commission preference — ever.
 *   • A "Why shown" reason exists only when BOTH the confirmed profile and the
 *     project record carry the supporting structured fact.
 *   • Everything ambiguous fails closed: ambiguous bedroom strings, absent
 *     readiness, missing/undated FX, unknown location, promotional rental
 *     language, unsupported trade-offs — no reason, never a fabricated one.
 *   • Trade-offs are NEVER synthesized from marketing copy. No verified
 *     trade-off source exists in the public projection today, so every card
 *     carries the honest absence statement instead.
 *   • Data uncertainty distinguishes: the guest didn't answer; the project has
 *     no usable structured fact; the required verified evidence is missing.
 */

import type { ConstructionStatus, Property } from "@/lib/data";
import { extractQuantifiedYieldPercent, isUnavailableValue } from "../matching";
import { wantsInvestmentV2, type DecisionProfileV2 } from "./profile";

export const NO_VERIFIED_TRADE_OFF_MESSAGE =
  "No verified trade-off statement yet — Guide review required";

export const NO_DIRECTION_MESSAGE =
  "No supported direction yet — showing the available projects; your Guide can prepare a shortlist";

export type DirectionDimension =
  | "property_type"
  | "location"
  | "readiness"
  | "bedrooms"
  | "budget"
  | "purpose_evidence";

export interface DirectionReason {
  dimension: DirectionDimension;
  label: string;
}

export type DirectionUnknownKind =
  | "guest_answer_missing"
  | "no_suitable_project_fact"
  | "project_evidence_missing";

export interface DirectionUnknown {
  dimension: DirectionDimension;
  kind: DirectionUnknownKind;
  label: string;
}

export interface DirectionCard {
  project: Property;
  /** "Why shown" — only source-backed facts, in stable dimension order. */
  whyShown: DirectionReason[];
  /**
   * A verified trade-off statement, or null when none exists. No public
   * verified trade-off source exists today, so this is always null — the UI
   * must then render NO_VERIFIED_TRADE_OFF_MESSAGE, never marketing copy.
   */
  tradeOff: string | null;
  unknowns: DirectionUnknown[];
  freshness: {
    /** The project's last price update, when it is an actual value. */
    lastPriceUpdate: string | null;
  };
}

export interface DirectionsEvaluation {
  /** Cards with at least one supported reason, in catalogue order. */
  directed: DirectionCard[];
  /** Every available project as a card, in catalogue order. */
  all: DirectionCard[];
  hasSupportedDirection: boolean;
  noDirectionMessage: string | null;
}

/* ---------- Conservative bedroom parsing ---------- */

export interface BedsRange {
  minimum: number;
  maximum: number;
}

const SINGLE_BEDS = /^(\d{1,2})$/;
const RANGE_BEDS = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/;

/**
 * Parse the display bedroom string conservatively. Only an unambiguous single
 * count ("2"), a clean numeric range ("1-3", "1–3"), or the exact word
 * "studio" are usable facts. Anything else ("1-3BR + Penthouse",
 * "Studio – 2BR", "flexible") is ambiguous and yields null — fail closed.
 */
export function parseBedsRange(beds: string | null | undefined): BedsRange | null {
  if (isUnavailableValue(beds)) return null;
  const value = (beds as string).trim().toLowerCase();
  if (value === "studio") return { minimum: 0, maximum: 0 };
  const single = SINGLE_BEDS.exec(value);
  if (single) {
    const count = Number(single[1]);
    return { minimum: count, maximum: count };
  }
  const range = RANGE_BEDS.exec(value);
  if (range) {
    const minimum = Number(range[1]);
    const maximum = Number(range[2]);
    if (minimum <= maximum) return { minimum, maximum };
  }
  return null;
}

const BEDROOM_PREFERENCE_COUNT: Record<string, number> = {
  studio: 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4_plus": 4,
};

/* ---------- Readiness mapping ---------- */

const OFF_PLAN_STATUSES: ConstructionStatus[] = [
  "Planning",
  "Pre-Launch",
  "Under Construction",
  "Nearing Completion",
];

/* ---------- The evaluator ---------- */

function evaluateDirectionCard(profile: DecisionProfileV2, project: Property): DirectionCard {
  const whyShown: DirectionReason[] = [];
  const unknowns: DirectionUnknown[] = [];

  // Property type — guest preference vs the typed project enum.
  const typePref = profile.essentials.propertyType;
  if (typePref === null || typePref === "unsure") {
    unknowns.push({
      dimension: "property_type",
      kind: "guest_answer_missing",
      label: "Property type preference not stated",
    });
  } else if (project.propertyType === "Not available") {
    unknowns.push({
      dimension: "property_type",
      kind: "no_suitable_project_fact",
      label: "Project property type not recorded",
    });
  } else {
    const matches =
      (typePref === "condominium" && project.propertyType === "Condominium") ||
      (typePref === "villa" && project.propertyType === "Villa") ||
      (typePref === "both" &&
        (project.propertyType === "Condominium" || project.propertyType === "Villa"));
    if (matches) {
      whyShown.push({
        dimension: "property_type",
        label: `Matches your ${project.propertyType.toLowerCase()} preference`,
      });
    }
  }

  // Location — stated preferred areas vs the project's actual location value.
  if (profile.essentials.preferredAreas.length === 0) {
    if (!profile.essentials.helpMeChooseArea) {
      unknowns.push({
        dimension: "location",
        kind: "guest_answer_missing",
        label: "Preferred area not stated",
      });
    }
    // "Help me choose based on lifestyle" is an explicit answer — the Guide
    // owns area guidance; no unknown and no reason is emitted.
  } else if (isUnavailableValue(project.location)) {
    unknowns.push({
      dimension: "location",
      kind: "no_suitable_project_fact",
      label: "Project location not recorded",
    });
  } else {
    const location = project.location.toLowerCase();
    const matched = profile.essentials.preferredAreas.find((area) =>
      location.includes(area.trim().toLowerCase()),
    );
    if (matched) {
      whyShown.push({
        dimension: "location",
        label: `In ${project.location}, one of your preferred areas`,
      });
    }
  }

  // Readiness — guest preference vs the project's construction status.
  const readiness = profile.essentials.readiness;
  if (readiness === null || readiness === "unsure") {
    unknowns.push({
      dimension: "readiness",
      kind: "guest_answer_missing",
      label: "Ready / off-plan preference not stated",
    });
  } else if (project.constructionStatus === "Not available") {
    unknowns.push({
      dimension: "readiness",
      kind: "no_suitable_project_fact",
      label: "Project construction status not recorded",
    });
  } else {
    const isReady = project.constructionStatus === "Ready";
    const isOffPlan = OFF_PLAN_STATUSES.includes(project.constructionStatus);
    const matches =
      (readiness === "ready" && isReady) ||
      (readiness === "off_plan" && isOffPlan) ||
      (readiness === "both" && (isReady || isOffPlan));
    if (matches) {
      whyShown.push({
        dimension: "readiness",
        label: isReady ? "Ready property, as you preferred" : "Off-plan, as you preferred",
      });
    }
  }

  // Bedrooms — only when the display string parses unambiguously.
  const bedroomPref = profile.essentials.bedrooms;
  if (bedroomPref === null || bedroomPref === "unsure") {
    unknowns.push({
      dimension: "bedrooms",
      kind: "guest_answer_missing",
      label: "Bedroom preference not stated",
    });
  } else {
    const range = parseBedsRange(project.beds);
    if (range === null) {
      unknowns.push({
        dimension: "bedrooms",
        kind: "no_suitable_project_fact",
        label: "Bedroom configuration not recorded in a comparable form",
      });
    } else {
      const wanted = BEDROOM_PREFERENCE_COUNT[bedroomPref];
      const matches =
        bedroomPref === "4_plus"
          ? range.maximum >= 4
          : wanted >= range.minimum && wanted <= range.maximum;
      if (matches) {
        whyShown.push({
          dimension: "bedrooms",
          label:
            bedroomPref === "studio"
              ? "Offers studio layouts"
              : bedroomPref === "4_plus"
                ? "Offers 4+ bedroom layouts"
                : `Offers ${wanted}-bedroom layouts`,
        });
      }
    }
  }

  // Budget — only with a truthful canonical THB budget AND a real THB price.
  if (profile.budget.state !== "stated") {
    unknowns.push({
      dimension: "budget",
      kind: "guest_answer_missing",
      label: "Budget still being explored",
    });
  } else if (profile.canonicalThb === null) {
    unknowns.push({
      dimension: "budget",
      kind: "project_evidence_missing",
      label: "Budget comparison unavailable — no dated, source-identified exchange rate",
    });
  } else if (!(project.startingPriceTHB > 0)) {
    unknowns.push({
      dimension: "budget",
      kind: "no_suitable_project_fact",
      label: "Project starting price not available",
    });
  } else {
    const { minimumTHB, maximumTHB, conversion } = profile.canonicalThb;
    const aboveMinimum = minimumTHB === null || project.startingPriceTHB >= minimumTHB;
    const belowMaximum = maximumTHB === null || project.startingPriceTHB <= maximumTHB;
    if (aboveMinimum && belowMaximum) {
      whyShown.push({
        dimension: "budget",
        label:
          conversion.kind === "identity"
            ? "Starting price within your stated THB budget"
            : `Starting price within your stated budget (converted at the ${conversion.source} rate of ${conversion.effectiveDate})`,
      });
    }
  }

  // Investment purpose — only with actually verified, quantified evidence.
  if (wantsInvestmentV2(profile)) {
    if (extractQuantifiedYieldPercent(project.rentalYield) !== null) {
      whyShown.push({
        dimension: "purpose_evidence",
        label: "Investment purpose supported by available project evidence",
      });
    } else {
      // Absent, sentinel, or promotional rental language: no evidence exists.
      unknowns.push({
        dimension: "purpose_evidence",
        kind: "project_evidence_missing",
        label: "No verified investment evidence on the project record",
      });
    }
  }

  return {
    project,
    whyShown,
    // No verified trade-off source exists in the public projection today.
    // Never synthesized from marketing copy; the UI renders the honest absence.
    tradeOff: null,
    unknowns,
    freshness: {
      lastPriceUpdate: isUnavailableValue(project.lastPriceUpdate) ? null : project.lastPriceUpdate,
    },
  };
}

/**
 * Evaluate the whole catalogue into direction cards. Catalogue order is
 * preserved exactly as ProjectService delivers it — no re-ranking, no scores.
 */
export function evaluateDirections(
  profile: DecisionProfileV2,
  projects: Property[],
): DirectionsEvaluation {
  const all = projects.map((project) => evaluateDirectionCard(profile, project));
  const directed = all.filter((card) => card.whyShown.length > 0);
  const hasSupportedDirection = directed.length > 0;
  return {
    directed,
    all,
    hasSupportedDirection,
    noDirectionMessage: hasSupportedDirection ? null : NO_DIRECTION_MESSAGE,
  };
}

/** Shared presentation rule (mirrors `visibleResults`) for the booth shell. */
export function visibleDirections(
  evaluation: DirectionsEvaluation,
  browseAll: boolean,
): DirectionCard[] {
  if (browseAll || !evaluation.hasSupportedDirection) return evaluation.all;
  return evaluation.directed;
}
