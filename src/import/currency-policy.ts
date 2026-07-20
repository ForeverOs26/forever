import type { Fact } from "./types";

export const CURRENCY_RULE_ID = "project_country_default_currency";
export const CURRENCY_RULE_VERSION = "1.0.0";
/** Owner-approved product scope: Forever currently handles Thailand projects in THB only. */
export const OWNER_SCOPE_COUNTRY = "Thailand" as const;
export const OWNER_SCOPE_CURRENCY = "THB" as const;

export type CurrencyDecisionStatus =
  | "source_verified"
  | "inferred_default"
  | "unresolved"
  | "conflict";

export interface CurrencyEvidence {
  value: string | null;
  status: "source_verified" | "unresolved";
  confidence: "high" | "medium" | "low" | "none";
  sourceFile?: string | null;
  sourcePage?: number | null;
  context?: string;
}

export interface CurrencyReviewFinding {
  code: "currency_evidence_conflict";
  currencies: string[];
  message: string;
}

export interface CurrencyDecision {
  value: string | null;
  status: CurrencyDecisionStatus;
  confidence: "high" | "medium" | "none";
  inferenceRule?: typeof CURRENCY_RULE_ID;
  inferenceRuleVersion?: typeof CURRENCY_RULE_VERSION;
  inferredFromCountry?: string;
  priceEvidence: CurrencyEvidence[];
  countryEvidence?: CurrencyEvidence;
  reviewFindings: CurrencyReviewFinding[];
}

const COUNTRY_DEFAULTS: Readonly<Record<string, string>> = {
  [OWNER_SCOPE_COUNTRY]: OWNER_SCOPE_CURRENCY,
};

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

export function currencyEvidenceFromFact(fact: Fact<string> | undefined): CurrencyEvidence {
  const value = normalizeCurrency(fact?.value);
  const sourceVerified =
    value !== null &&
    fact?.confidence !== "none" &&
    (fact?.status === undefined || fact.status === "source_verified");
  return {
    value,
    status: sourceVerified ? "source_verified" : "unresolved",
    confidence:
      fact?.confidence === "high" || fact?.confidence === "medium" || fact?.confidence === "low"
        ? fact.confidence
        : "none",
    sourceFile: fact?.source_file,
    sourcePage: fact?.page_number,
    context:
      fact?.status === "inferred_default"
        ? "selling-price row (Owner-approved default, not source evidence)"
        : "selling-price row",
  };
}

export function decideCurrency(input: {
  priceEvidence: CurrencyEvidence[];
  countryEvidence?: CurrencyEvidence;
}): CurrencyDecision {
  const verifiedCurrencies = [
    ...new Set(
      input.priceEvidence
        .filter((evidence) => evidence.status === "source_verified")
        .map((evidence) => normalizeCurrency(evidence.value))
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();

  if (verifiedCurrencies.length > 1) {
    return {
      value: null,
      status: "conflict",
      confidence: "none",
      priceEvidence: input.priceEvidence,
      countryEvidence: input.countryEvidence,
      reviewFindings: [
        {
          code: "currency_evidence_conflict",
          currencies: verifiedCurrencies,
          message: `Authoritative price evidence conflicts: ${verifiedCurrencies.join(" versus ")}.`,
        },
      ],
    };
  }

  if (verifiedCurrencies.length === 1) {
    return {
      value: verifiedCurrencies[0],
      status: "source_verified",
      confidence: "high",
      priceEvidence: input.priceEvidence,
      countryEvidence: input.countryEvidence,
      reviewFindings: [],
    };
  }

  const country = input.countryEvidence?.value ?? OWNER_SCOPE_COUNTRY;
  const inferred =
    (!input.countryEvidence || input.countryEvidence.status === "source_verified") && country
      ? COUNTRY_DEFAULTS[country]
      : undefined;

  if (inferred) {
    return {
      value: inferred,
      status: "inferred_default",
      confidence: "medium",
      inferenceRule: CURRENCY_RULE_ID,
      inferenceRuleVersion: CURRENCY_RULE_VERSION,
      inferredFromCountry: country ?? undefined,
      priceEvidence: input.priceEvidence,
      countryEvidence: input.countryEvidence,
      reviewFindings: [],
    };
  }

  return {
    value: null,
    status: "unresolved",
    confidence: "none",
    priceEvidence: input.priceEvidence,
    countryEvidence: input.countryEvidence,
    reviewFindings: [],
  };
}
