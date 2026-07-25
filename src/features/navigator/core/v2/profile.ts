/**
 * DecisionProfileV2 — the versioned shared profile contract (Booth Mode 2.0).
 *
 * V2 extends the NAV-001 psychological profile with the Search Essentials the
 * booth captures (property type, bedrooms, areas, readiness), a purchase
 * purpose, a budget the guest states as EXPLICIT NUMERIC AMOUNTS in their own
 * currency, and an optional canonical THB representation that exists ONLY when
 * a dated, source-identified exchange rate is configured. No rate is ever
 * invented: missing FX data disables budget comparison instead of creating a
 * mismatch, and the approved USD NAV-001 bands are never reinterpreted as
 * amounts in another currency.
 *
 * The website Navigator keeps producing legacy `NavigatorAnswers`; the
 * `profileV2FromLegacyAnswers` adapter lifts them into V2 with every Search
 * Essential honestly unknown, so website behaviour does not change.
 *
 * ONE canonical strict schema (`decisionProfileV2Schema`) validates every
 * persisted or transported payload — session hydration and the server boundary
 * both use it, so a payload the browser accepts is exactly the payload the
 * server accepts. Anything malformed, oversized, of an unknown version, or
 * carrying unknown keys is rejected outright; nothing is coerced or cast.
 */

import { z } from "zod";

import {
  CONCERN_OPTIONS,
  SUCCESS_OPTIONS,
  TIMELINE_OPTIONS,
  WHY_PHUKET_OPTIONS,
  type BudgetKey,
  type ConcernKey,
  type GoalKey,
  type MotivationKey,
  type TimelineKey,
} from "../questions";
import type { NavigatorAnswers } from "../decision-profile";

export const DECISION_PROFILE_VERSION = 2 as const;

export type FlowMode = "quick" | "full";

export type PurchasePurpose = "lifestyle" | "investment" | "both" | "exploring";

/** Currencies a guest may state a budget in. Purely a label set — never a rate. */
export const BOOTH_BUDGET_CURRENCIES = ["USD", "EUR", "GBP", "THB", "RUB", "CNY"] as const;
export type BoothBudgetCurrency = (typeof BOOTH_BUDGET_CURRENCIES)[number];

export type BudgetStateV2 = "stated" | "exploring";

/** Guardrails for a stated amount: finite, non-negative, and not absurd. */
export const MAX_BUDGET_AMOUNT = 1_000_000_000_000;
export const MAX_PREFERRED_AREAS = 8;
export const MAX_AREA_LENGTH = 80;
export const MAX_NOTE_LENGTH = 500;
export const MAX_LANGUAGE_LENGTH = 60;
/** Hard ceiling on a transported profile payload (defensive, not a policy). */
export const MAX_PROFILE_PAYLOAD_BYTES = 8_192;

/**
 * A budget range in the guest's ORIGINAL currency, stated as explicit numeric
 * amounts. `minimum: null` means "no lower bound stated"; `maximum: null` means
 * "no upper bound stated". When `state` is "exploring" no amounts or currency
 * are carried — an exploring guest has stated no budget fact at all.
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

export function statedBudget(
  minimum: number | null,
  maximum: number | null,
  originalCurrency: BoothBudgetCurrency,
): BudgetRangeV2 {
  return { state: "stated", minimum, maximum, originalCurrency };
}

export type BudgetValidationError =
  | "currency_required"
  | "amount_required"
  | "amount_invalid"
  | "range_inverted";

/**
 * Validate a guest-stated budget. A stated budget needs a currency, at least
 * one finite non-negative amount, and a coherent minimum <= maximum.
 */
export function validateBudgetRange(budget: BudgetRangeV2): BudgetValidationError | null {
  if (budget.state === "exploring") return null;
  if (budget.originalCurrency === null) return "currency_required";
  if (budget.minimum === null && budget.maximum === null) return "amount_required";
  for (const amount of [budget.minimum, budget.maximum]) {
    if (amount === null) continue;
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_BUDGET_AMOUNT) {
      return "amount_invalid";
    }
  }
  if (budget.minimum !== null && budget.maximum !== null && budget.minimum > budget.maximum) {
    return "range_inverted";
  }
  return null;
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
  if (validateBudgetRange(budget) !== null) return null;

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

/* ---------- Deterministic purpose derivation ---------- */

const INVESTMENT_MOTIVATIONS: MotivationKey[] = ["investment"];
const INVESTMENT_GOALS: GoalKey[] = ["rental_income", "financial_security"];

/**
 * The established NAV-001 derivation: an investment signal is an explicit
 * investment motivation or an investment-shaped goal; a lifestyle signal is any
 * other motivation or goal. Both → "both"; neither → "exploring". The Full
 * flow uses this instead of asking a redundant question, so a completed Full
 * profile can never silently fall back to "exploring" while the answers say
 * otherwise.
 */
export function derivePurchasePurpose(answers: {
  motivations: readonly MotivationKey[];
  goals: readonly GoalKey[];
}): PurchasePurpose {
  const investment =
    answers.motivations.some((key) => INVESTMENT_MOTIVATIONS.includes(key)) ||
    answers.goals.some((key) => INVESTMENT_GOALS.includes(key));
  const lifestyle =
    answers.motivations.some((key) => !INVESTMENT_MOTIVATIONS.includes(key)) ||
    answers.goals.some((key) => !INVESTMENT_GOALS.includes(key));
  if (investment && lifestyle) return "both";
  if (investment) return "investment";
  if (lifestyle) return "lifestyle";
  return "exploring";
}

/* ---------- Legacy adapter (website NAV-001 answers → V2) ---------- */

/**
 * The USD amounts implied by the approved NAV-001 budget bands. These are the
 * bands' own boundaries as printed on the website in USD — they are NEVER
 * reused as amounts in another currency (the booth collects explicit numbers
 * instead), and they are never a conversion.
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

/** Legacy website bands only. The booth never calls this. */
export function budgetV2FromLegacyBand(budget: BudgetKey | null): BudgetRangeV2 {
  if (!budget) return exploringBudget();
  const range = LEGACY_BAND_RANGE[budget];
  if (!range) return exploringBudget();
  return {
    state: "stated",
    minimum: range.minimum,
    maximum: range.maximum,
    originalCurrency: "USD",
  };
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
    purchasePurpose: derivePurchasePurpose(answers),
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

/* ---------- The ONE canonical strict schema ---------- */

const motivationKeys = WHY_PHUKET_OPTIONS.map((option) => option.key) as [
  MotivationKey,
  ...MotivationKey[],
];
const goalKeys = SUCCESS_OPTIONS.map((option) => option.key) as [GoalKey, ...GoalKey[]];
const concernKeys = CONCERN_OPTIONS.map((option) => option.key) as [ConcernKey, ...ConcernKey[]];
const timelineKeys = TIMELINE_OPTIONS.map((option) => option.key) as [
  TimelineKey,
  ...TimelineKey[],
];

const uniqueBoundedKeys = <T extends string>(values: [T, ...T[]], max: number) =>
  z
    .array(z.enum(values))
    .max(max)
    .refine((list) => new Set(list).size === list.length, {
      message: "duplicate answer keys",
    });

const amountSchema = z.number().finite().nonnegative().max(MAX_BUDGET_AMOUNT).nullable();

const budgetSchema = z
  .object({
    state: z.enum(["stated", "exploring"]),
    minimum: amountSchema,
    maximum: amountSchema,
    originalCurrency: z.enum(BOOTH_BUDGET_CURRENCIES).nullable(),
  })
  .strict()
  .superRefine((budget, ctx) => {
    if (budget.state === "exploring") {
      // An exploring guest states no amounts and no currency.
      if (budget.minimum !== null || budget.maximum !== null || budget.originalCurrency !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "exploring budget carries no amounts",
        });
      }
      return;
    }
    const error = validateBudgetRange(budget as BudgetRangeV2);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `budget ${error}` });
  });

const canonicalThbSchema = z
  .object({
    minimumTHB: z.number().finite().nonnegative().nullable(),
    maximumTHB: z.number().finite().nonnegative().nullable(),
    conversion: z.union([
      z.object({ kind: z.literal("identity") }).strict(),
      z
        .object({
          kind: z.literal("converted"),
          source: z.string().trim().min(1).max(200),
          effectiveDate: z.string().regex(ISO_DATE_PATTERN),
          thbPerUnit: z.number().finite().positive(),
        })
        .strict(),
    ]),
  })
  .strict();

const essentialsSchema = z
  .object({
    propertyType: z.enum(["condominium", "villa", "both", "unsure"]).nullable(),
    bedrooms: z.enum(["studio", "1", "2", "3", "4_plus", "unsure"]).nullable(),
    preferredAreas: z
      .array(z.string().trim().min(1).max(MAX_AREA_LENGTH))
      .max(MAX_PREFERRED_AREAS)
      .refine((list) => new Set(list).size === list.length, { message: "duplicate areas" }),
    helpMeChooseArea: z.boolean(),
    readiness: z.enum(["ready", "off_plan", "both", "unsure"]).nullable(),
  })
  .strict()
  .refine((essentials) => !(essentials.helpMeChooseArea && essentials.preferredAreas.length > 0), {
    message: "help-me-choose and explicit areas are mutually exclusive",
  });

const isoTimestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), { message: "invalid ISO timestamp" });

export const decisionProfileV2Schema = z
  .object({
    profileVersion: z.literal(DECISION_PROFILE_VERSION),
    flowMode: z.enum(["quick", "full"]),
    purchasePurpose: z.enum(["lifestyle", "investment", "both", "exploring"]),
    motivations: uniqueBoundedKeys(motivationKeys, 3),
    goals: uniqueBoundedKeys(goalKeys, 3),
    concerns: uniqueBoundedKeys(concernKeys, 3),
    note: z.string().max(MAX_NOTE_LENGTH),
    budget: budgetSchema,
    canonicalThb: canonicalThbSchema.nullable(),
    timeline: z.enum(timelineKeys).nullable(),
    essentials: essentialsSchema,
    preferredLanguage: z.string().trim().min(1).max(MAX_LANGUAGE_LENGTH).nullable(),
    confirmedAt: isoTimestamp.nullable(),
  })
  .strict()
  .superRefine((profile, ctx) => {
    // Canonical THB must be arithmetically and provenance-consistent with the
    // stated budget: an identity only for THB, a conversion only for a
    // non-THB currency, and the amounts must actually follow from the rate.
    const canonical = profile.canonicalThb;
    if (canonical) {
      if (profile.budget.state !== "stated") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "canonical THB without a stated budget",
        });
        return;
      }
      const isTHB = profile.budget.originalCurrency === "THB";
      if ((canonical.conversion.kind === "identity") !== isTHB) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "canonical THB provenance mismatch" });
        return;
      }
      const rate = canonical.conversion.kind === "identity" ? 1 : canonical.conversion.thbPerUnit;
      const expected = (amount: number | null) => (amount === null ? null : amount * rate);
      const close = (a: number | null, b: number | null) =>
        a === null || b === null ? a === b : Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);
      if (
        !close(canonical.minimumTHB, expected(profile.budget.minimum)) ||
        !close(canonical.maximumTHB, expected(profile.budget.maximum))
      ) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "canonical THB arithmetic mismatch" });
      }
    }

    // Flow completeness: a confirmed profile must actually carry the answers
    // its own flow promises.
    if (profile.confirmedAt === null) return;
    if (profile.flowMode === "quick") {
      if (profile.essentials.propertyType === null || profile.timeline === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "incomplete Quick profile" });
      }
      return;
    }
    const essentials = profile.essentials;
    const areasAnswered = essentials.preferredAreas.length > 0 || essentials.helpMeChooseArea;
    if (
      profile.motivations.length === 0 ||
      profile.goals.length === 0 ||
      profile.concerns.length === 0 ||
      profile.timeline === null ||
      essentials.propertyType === null ||
      essentials.bedrooms === null ||
      essentials.readiness === null ||
      !areasAnswered
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "incomplete Full profile" });
    }
  });

/**
 * Parse a persisted / transported profile payload with the canonical schema.
 * Anything malformed, oversized, unversioned, of an unknown version, or
 * carrying unknown keys returns `null` — an obsolete or tampered payload is
 * never partially trusted, coerced, or silently upgraded.
 */
export function parseStoredProfileV2(raw: unknown): DecisionProfileV2 | null {
  if (raw === null || typeof raw !== "object") return null;
  try {
    if (JSON.stringify(raw).length > MAX_PROFILE_PAYLOAD_BYTES) return null;
  } catch {
    return null; // circular or otherwise non-serializable
  }
  const result = decisionProfileV2Schema.safeParse(raw);
  return result.success ? (result.data as DecisionProfileV2) : null;
}
