/**
 * DecisionProfileV2 — the versioned shared profile contract (Booth Mode 2.0).
 *
 * V2 extends the NAV-001 psychological profile with the Search Essentials the
 * booth captures (property type, bedrooms, areas, readiness), an explicit
 * purchase purpose, a budget range that keeps its ORIGINAL currency, and an
 * optional canonical THB representation that exists ONLY when a dated,
 * source-identified exchange rate is configured. No rate is ever invented:
 * missing FX data disables budget comparison instead of creating a mismatch.
 *
 * The website Navigator keeps producing legacy `NavigatorAnswers`; the
 * `profileV2FromLegacyAnswers` adapter lifts them into V2 with every Search
 * Essential honestly unknown, so website behaviour does not change.
 *
 * Persisted payloads are versioned and parsed fail-closed: an unknown or
 * malformed payload yields `null`, never a partially-trusted profile.
 */

import type { BudgetKey, ConcernKey, GoalKey, MotivationKey, TimelineKey } from "../questions";
import type { NavigatorAnswers } from "../decision-profile";

export const DECISION_PROFILE_VERSION = 2 as const;

export type FlowMode = "quick" | "full";

export type PurchasePurpose = "lifestyle" | "investment" | "both" | "exploring";

/** Currencies a guest may state a budget in. Purely a label set — never a rate. */
export const BOOTH_BUDGET_CURRENCIES = ["USD", "EUR", "GBP", "THB", "RUB", "CNY"] as const;
export type BoothBudgetCurrency = (typeof BOOTH_BUDGET_CURRENCIES)[number];

export type BudgetStateV2 = "stated" | "exploring";

/**
 * A budget range in the guest's ORIGINAL currency. `maximum: null` means an
 * open-ended top band. When `state` is "exploring" no amounts or currency are
 * carried — an exploring guest has stated no budget fact.
 */
export interface BudgetRangeV2 {
  state: BudgetStateV2;
  minimum: number | null;
  maximum: number | null;
  originalCurrency: BoothBudgetCurrency | null;
}

export function exploringBudget(): BudgetRangeV2 {
  return { state: "exploring", minimum: null, maximum: null, originalCurrency: null };
}

/**
 * A dated, source-identified exchange-rate configuration (pilot: provided by
 * the operator through server config — never fetched, never defaulted, never
 * hard-coded). Absence of this config honestly disables budget comparison.
 */
export interface FxRateConfig {
  source: string;
  /** ISO date the quoted rates were effective, e.g. "2026-07-25". */
  effectiveDate: string;
  /** THB per one unit of the original currency. THB itself needs no entry. */
  thbPerUnit: Partial<Record<BoothBudgetCurrency, number>>;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Parse an operator-provided FX config, fail-closed on anything malformed. */
export function parseFxRateConfig(raw: unknown): FxRateConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<FxRateConfig>;
  if (typeof candidate.source !== "string" || candidate.source.trim().length === 0) return null;
  if (
    typeof candidate.effectiveDate !== "string" ||
    !ISO_DATE_PATTERN.test(candidate.effectiveDate)
  ) {
    return null;
  }
  if (!candidate.thbPerUnit || typeof candidate.thbPerUnit !== "object") return null;
  const thbPerUnit: Partial<Record<BoothBudgetCurrency, number>> = {};
  for (const currency of BOOTH_BUDGET_CURRENCIES) {
    const value = (candidate.thbPerUnit as Record<string, unknown>)[currency];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    thbPerUnit[currency] = value;
  }
  return { source: candidate.source.trim(), effectiveDate: candidate.effectiveDate, thbPerUnit };
}

/**
 * The canonical THB representation of a stated budget. It exists only when the
 * original currency is THB itself (identity — no conversion invented) or when
 * a dated, source-identified rate covers the original currency.
 */
export type CanonicalThbConversion =
  | { kind: "identity" }
  | { kind: "converted"; source: string; effectiveDate: string; thbPerUnit: number };

export interface CanonicalThbBudget {
  minimumTHB: number | null;
  maximumTHB: number | null;
  conversion: CanonicalThbConversion;
}

export function canonicalThbBudget(
  budget: BudgetRangeV2,
  fx: FxRateConfig | null,
): CanonicalThbBudget | null {
  if (budget.state !== "stated" || budget.originalCurrency === null) return null;
  if (budget.minimum === null && budget.maximum === null) return null;

  if (budget.originalCurrency === "THB") {
    return {
      minimumTHB: budget.minimum,
      maximumTHB: budget.maximum,
      conversion: { kind: "identity" },
    };
  }

  const rate = fx?.thbPerUnit[budget.originalCurrency];
  if (!fx || rate === undefined) return null; // no dated verified rate → no canonical budget

  return {
    minimumTHB: budget.minimum === null ? null : budget.minimum * rate,
    maximumTHB: budget.maximum === null ? null : budget.maximum * rate,
    conversion: {
      kind: "converted",
      source: fx.source,
      effectiveDate: fx.effectiveDate,
      thbPerUnit: rate,
    },
  };
}

/* ---------- Search Essentials ---------- */

export type PropertyTypePreference = "condominium" | "villa" | "both" | "unsure";
export type BedroomPreference = "studio" | "1" | "2" | "3" | "4_plus" | "unsure";
export type ReadinessPreference = "ready" | "off_plan" | "both" | "unsure";

export interface SearchEssentials {
  /** null = the question was never asked (e.g. legacy website answers). */
  propertyType: PropertyTypePreference | null;
  bedrooms: BedroomPreference | null;
  preferredAreas: string[];
  /** "Help me choose based on lifestyle" — an explicit answer, not an absence. */
  helpMeChooseArea: boolean;
  readiness: ReadinessPreference | null;
}

export function unknownEssentials(): SearchEssentials {
  return {
    propertyType: null,
    bedrooms: null,
    preferredAreas: [],
    helpMeChooseArea: false,
    readiness: null,
  };
}

/* ---------- The profile ---------- */

export interface DecisionProfileV2 {
  profileVersion: typeof DECISION_PROFILE_VERSION;
  flowMode: FlowMode;
  purchasePurpose: PurchasePurpose;
  /** NAV-001 psychological answers — empty arrays in the Quick flow. */
  motivations: MotivationKey[];
  goals: GoalKey[];
  concerns: ConcernKey[];
  note: string;
  budget: BudgetRangeV2;
  /** Present only when a truthful THB representation exists (see above). */
  canonicalThb: CanonicalThbBudget | null;
  timeline: TimelineKey | null;
  essentials: SearchEssentials;
  preferredLanguage: string | null;
  /** ISO timestamp of guest confirmation; null while still a draft. */
  confirmedAt: string | null;
}

/** True when the profile states an investment intent. */
export function wantsInvestmentV2(profile: DecisionProfileV2): boolean {
  return profile.purchasePurpose === "investment" || profile.purchasePurpose === "both";
}

/* ---------- Legacy adapter (website NAV-001 answers → V2) ---------- */

/**
 * The USD amounts implied by the approved NAV-001 budget bands. These are the
 * bands' own boundaries, not conversions — the band labels are quoted in USD.
 */
const LEGACY_BAND_RANGE: Record<
  BudgetKey,
  { minimum: number | null; maximum: number | null } | null
> = {
  lt_250k: { minimum: null, maximum: 250_000 },
  "250_500k": { minimum: 250_000, maximum: 500_000 },
  "500k_1m": { minimum: 500_000, maximum: 1_000_000 },
  "1m_2_5m": { minimum: 1_000_000, maximum: 2_500_000 },
  gt_2_5m: { minimum: 2_500_000, maximum: null },
  exploring: null,
};

/**
 * Budget range implied by an approved NAV-001 band, in the guest's stated
 * original currency. The band boundaries are the guest's own statement in
 * that currency — never a conversion.
 */
export function budgetV2FromBand(
  budget: BudgetKey | null,
  currency: BoothBudgetCurrency,
): BudgetRangeV2 {
  if (!budget) return exploringBudget();
  const range = LEGACY_BAND_RANGE[budget];
  if (!range) return exploringBudget();
  return {
    state: "stated",
    minimum: range.minimum,
    maximum: range.maximum,
    originalCurrency: currency,
  };
}

export function budgetV2FromLegacyBand(budget: BudgetKey | null): BudgetRangeV2 {
  // NAV-001 band labels are quoted in USD.
  return budgetV2FromBand(budget, "USD");
}

function legacyPurchasePurpose(answers: NavigatorAnswers): PurchasePurpose {
  const investment =
    answers.motivations.includes("investment") ||
    answers.goals.includes("rental_income") ||
    answers.goals.includes("financial_security");
  const lifestyle =
    answers.motivations.some((m) => m !== "investment") ||
    answers.goals.some((g) => g !== "rental_income" && g !== "financial_security");
  if (investment && lifestyle) return "both";
  if (investment) return "investment";
  if (lifestyle) return "lifestyle";
  return "exploring";
}

/**
 * Lift legacy website answers into V2. Every Search Essential is honestly
 * unknown — the website never asked those questions — and the profile stays
 * unconfirmed (`confirmedAt: null`). Website behaviour does not change; this
 * adapter only lets shared V2 consumers read legacy data safely.
 */
export function profileV2FromLegacyAnswers(
  answers: NavigatorAnswers,
  fx: FxRateConfig | null = null,
): DecisionProfileV2 {
  const budget = budgetV2FromLegacyBand(answers.budget);
  return {
    profileVersion: DECISION_PROFILE_VERSION,
    flowMode: "full",
    purchasePurpose: legacyPurchasePurpose(answers),
    motivations: [...answers.motivations],
    goals: [...answers.goals],
    concerns: [...answers.concerns],
    note: answers.note,
    budget,
    canonicalThb: canonicalThbBudget(budget, fx),
    timeline: answers.timeline,
    essentials: unknownEssentials(),
    preferredLanguage: null,
    confirmedAt: null,
  };
}

/* ---------- Fail-closed parsing of persisted payloads ---------- */

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Parse a persisted / transported profile payload. Anything malformed,
 * unversioned, or of an unknown version returns `null` — an obsolete payload
 * is never partially trusted or silently upgraded.
 */
export function parseStoredProfileV2(raw: unknown): DecisionProfileV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.profileVersion !== DECISION_PROFILE_VERSION) return null;
  if (candidate.flowMode !== "quick" && candidate.flowMode !== "full") return null;
  const purpose = candidate.purchasePurpose;
  if (
    purpose !== "lifestyle" &&
    purpose !== "investment" &&
    purpose !== "both" &&
    purpose !== "exploring"
  ) {
    return null;
  }
  if (
    !isStringArray(candidate.motivations) ||
    !isStringArray(candidate.goals) ||
    !isStringArray(candidate.concerns)
  ) {
    return null;
  }
  const budget = candidate.budget as BudgetRangeV2 | undefined;
  if (!budget || typeof budget !== "object") return null;
  if (budget.state !== "stated" && budget.state !== "exploring") return null;
  const essentials = candidate.essentials as SearchEssentials | undefined;
  if (!essentials || typeof essentials !== "object") return null;
  if (!isStringArray(essentials.preferredAreas)) return null;

  return {
    profileVersion: DECISION_PROFILE_VERSION,
    flowMode: candidate.flowMode,
    purchasePurpose: purpose,
    motivations: candidate.motivations as MotivationKey[],
    goals: candidate.goals as GoalKey[],
    concerns: candidate.concerns as ConcernKey[],
    note: typeof candidate.note === "string" ? candidate.note : "",
    budget: {
      state: budget.state,
      minimum: typeof budget.minimum === "number" ? budget.minimum : null,
      maximum: typeof budget.maximum === "number" ? budget.maximum : null,
      originalCurrency: BOOTH_BUDGET_CURRENCIES.includes(
        budget.originalCurrency as BoothBudgetCurrency,
      )
        ? (budget.originalCurrency as BoothBudgetCurrency)
        : null,
    },
    canonicalThb: parseStoredCanonicalThb(candidate.canonicalThb),
    timeline: typeof candidate.timeline === "string" ? (candidate.timeline as TimelineKey) : null,
    essentials: {
      propertyType: parsePreference(essentials.propertyType, [
        "condominium",
        "villa",
        "both",
        "unsure",
      ]),
      bedrooms: parsePreference(essentials.bedrooms, ["studio", "1", "2", "3", "4_plus", "unsure"]),
      preferredAreas: essentials.preferredAreas,
      helpMeChooseArea: essentials.helpMeChooseArea === true,
      readiness: parsePreference(essentials.readiness, ["ready", "off_plan", "both", "unsure"]),
    },
    preferredLanguage:
      typeof candidate.preferredLanguage === "string" ? candidate.preferredLanguage : null,
    confirmedAt: typeof candidate.confirmedAt === "string" ? candidate.confirmedAt : null,
  };
}

function parsePreference<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function parseStoredCanonicalThb(raw: unknown): CanonicalThbBudget | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as CanonicalThbBudget;
  const conversion = candidate.conversion;
  if (!conversion || typeof conversion !== "object") return null;
  if (conversion.kind === "identity") {
    return {
      minimumTHB: typeof candidate.minimumTHB === "number" ? candidate.minimumTHB : null,
      maximumTHB: typeof candidate.maximumTHB === "number" ? candidate.maximumTHB : null,
      conversion: { kind: "identity" },
    };
  }
  if (conversion.kind === "converted") {
    if (
      typeof conversion.source !== "string" ||
      conversion.source.trim().length === 0 ||
      typeof conversion.effectiveDate !== "string" ||
      !ISO_DATE_PATTERN.test(conversion.effectiveDate) ||
      typeof conversion.thbPerUnit !== "number" ||
      !Number.isFinite(conversion.thbPerUnit) ||
      conversion.thbPerUnit <= 0
    ) {
      return null; // an undated or unsourced conversion is never trusted
    }
    return {
      minimumTHB: typeof candidate.minimumTHB === "number" ? candidate.minimumTHB : null,
      maximumTHB: typeof candidate.maximumTHB === "number" ? candidate.maximumTHB : null,
      conversion: {
        kind: "converted",
        source: conversion.source,
        effectiveDate: conversion.effectiveDate,
        thbPerUnit: conversion.thbPerUnit,
      },
    };
  }
  return null;
}
