/**
 * Fast Intake v1 — anti-fabrication input validation.
 *
 * A source value becomes a fact ONLY when it survives these guards. Sentinels
 * ("Not available", "Unknown", "N/A", …), empty/whitespace values, confidence
 * `none`/unknown, missing source references, and malformed dates are never used
 * as positive facts. Price rows with zero/negative/non-numeric prices,
 * unsupported currencies, or missing unit identifiers are dropped with explicit
 * warnings; duplicate unit identifiers are a blocking conflict.
 *
 * Nothing here infers a fact from a filename, folder, classification, CLI name,
 * or placeholder.
 */

import type { ExtractedPriceList, ExtractedPriceListRow, Fact } from "@/import/types";
import type { ProgressiveWarning } from "@/features/forever-ingestion/batch-types";

import type { IntakeFact } from "./types";

export class IntakeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeConflictError";
  }
}

/** Values that must never be treated as a positive fact. */
const SENTINELS = new Set([
  "",
  "not available",
  "notavailable",
  "n/a",
  "n.a.",
  "na",
  "unknown",
  "none",
  "null",
  "nil",
  "tbd",
  "tba",
  "to be confirmed",
  "to be advised",
  "-",
  "--",
  "–",
  "—",
  "?",
  "??",
  "???",
  "x",
  "xx",
]);

const USABLE_CONFIDENCE = new Set(["high", "medium", "low"]);

/** Supported ISO 4217 currencies for Fast Intake v1. */
export const SUPPORTED_CURRENCIES = new Set([
  "THB",
  "USD",
  "EUR",
  "GBP",
  "SGD",
  "AUD",
  "AED",
  "HKD",
  "CHF",
  "JPY",
  "CNY",
  "RUB",
]);

export function isSentinelValue(value: unknown): boolean {
  return SENTINELS.has(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

/** A value usable as a fact: present, non-empty after trim, not a sentinel. */
export function isUsableFactValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (text.length === 0) return false;
  return !isSentinelValue(text);
}

export function isUsableConfidence(confidence: unknown): boolean {
  return typeof confidence === "string" && USABLE_CONFIDENCE.has(confidence);
}

/** Strict ISO calendar date `YYYY-MM-DD`. */
export function isValidIsoDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** A plausible country name: letters/spaces/&.'- only, 2–60 chars, not a sentinel. */
export function isUsableCountry(value: unknown): boolean {
  if (!isUsableFactValue(value)) return false;
  const text = String(value).trim();
  return text.length >= 2 && text.length <= 60 && /^[A-Za-z][A-Za-z .,'&()-]*$/.test(text);
}

/**
 * A fully validated intake fact, or `null` when it must be treated as absent.
 * Enforces: usable value, usable confidence (not `none`/unknown), a present
 * source reference, and — when present — a valid ISO `source_date`.
 */
export function usableIntakeFact(
  fact: IntakeFact | undefined,
): (IntakeFact & { value: string }) | null {
  if (!fact) return null;
  if (!isUsableFactValue(fact.value)) return null;
  if (!isUsableConfidence(fact.confidence)) return null;
  const ref = fact.source_ref ?? fact.source_file;
  if (!isUsableFactValue(ref)) return null;
  if (fact.source_date !== undefined && !isValidIsoDate(fact.source_date)) return null;
  return { ...fact, value: String(fact.value).trim() };
}

/** Parse a price string/number to a strictly positive finite number, or null. */
export function parsePositivePrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/,/g, "").trim();
  if (!/^\d*\.?\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isUsableExtractedFact<T>(fact: Fact<T> | undefined): fact is Fact<T> & { value: T } {
  return Boolean(
    fact &&
    isUsableFactValue(fact.value) &&
    isUsableConfidence(fact.confidence) &&
    isUsableFactValue(fact.source_file),
  );
}

function factValue<T>(fact: Fact<T> | undefined): T | null {
  return isUsableExtractedFact(fact) ? fact.value : null;
}

function nulledFact(source: Fact | undefined): Fact {
  return {
    value: null,
    source_file: source?.source_file ?? null,
    page_number: source?.page_number ?? null,
    confidence: "none",
  };
}

export interface SanitizedPriceList {
  priceList: ExtractedPriceList | null;
  warnings: ProgressiveWarning[];
  skippedRows: number;
}

/**
 * Sanitize an extracted price list before the canonical builder sees it:
 *  - drop rows with a missing/unusable unit identifier (warned);
 *  - reject duplicate unit identifiers as a BLOCKING conflict;
 *  - null out zero/negative/non-numeric prices (→ price omitted + warned);
 *  - null out unsupported currencies (→ currency unresolved + warned).
 */
export function sanitizePriceList(priceList: ExtractedPriceList | null): SanitizedPriceList {
  if (!priceList || !Array.isArray(priceList.unit_inventory)) {
    return { priceList, warnings: [], skippedRows: 0 };
  }
  const warnings: ProgressiveWarning[] = [];
  const seenUnitCodes = new Map<string, number>();
  const duplicates = new Set<string>();
  const rows: ExtractedPriceListRow[] = [];
  let skippedRows = 0;
  let invalidPrices = 0;
  let unsupportedCurrencies = 0;
  let invalidSourceFacts = 0;

  let priceListDate = priceList.price_list_date;
  if (priceListDate?.value != null) {
    if (!isUsableExtractedFact(priceListDate) || !isValidIsoDate(priceListDate.value)) {
      priceListDate = nulledFact(priceListDate) as Fact<string>;
      warnings.push({
        entity: "price",
        field: "price_list_date",
        code: "price_list_date_invalid",
        severity: "warning",
        message: "The price-list date was malformed or lacked usable provenance and was not used.",
      });
    }
  }

  for (const row of priceList.unit_inventory) {
    let nextRow: ExtractedPriceListRow = { ...row };
    for (const key of Object.keys(nextRow) as Array<keyof ExtractedPriceListRow>) {
      if (key === "source_row") continue;
      const candidate = nextRow[key];
      if (!candidate || typeof candidate !== "object" || !("value" in candidate)) continue;
      const fact = candidate as Fact;
      if (fact.value != null && fact.confidence !== "none" && !isUsableExtractedFact(fact)) {
        invalidSourceFacts += 1;
        (nextRow as Record<string, unknown>)[key] = nulledFact(fact);
      }
    }

    const unitCode = factValue(nextRow.unit_number);
    if (unitCode == null || !isUsableFactValue(unitCode)) {
      skippedRows += 1;
      continue;
    }
    const code = String(unitCode).trim();
    seenUnitCodes.set(code, (seenUnitCodes.get(code) ?? 0) + 1);
    if ((seenUnitCodes.get(code) ?? 0) > 1) duplicates.add(code);

    // Prices must be strictly positive and numeric to be a fact.
    const rawPrice = factValue(nextRow.price);
    if (rawPrice != null && parsePositivePrice(rawPrice) == null) {
      invalidPrices += 1;
      nextRow = { ...nextRow, price: nulledFact(nextRow.price) as Fact<string | number> };
    }

    // Only supported ISO currencies are kept as source-stated currency.
    const rawCurrency = factValue(nextRow.currency);
    if (
      rawCurrency != null &&
      !SUPPORTED_CURRENCIES.has(String(rawCurrency).trim().toUpperCase())
    ) {
      unsupportedCurrencies += 1;
      nextRow = { ...nextRow, currency: nulledFact(nextRow.currency) as Fact<string> };
    }

    rows.push(nextRow);
  }

  if (duplicates.size > 0) {
    throw new IntakeConflictError(
      `intake_duplicate_unit_identifiers: ${[...duplicates].sort().join(", ")}`,
    );
  }
  if (skippedRows > 0) {
    warnings.push({
      entity: "unit",
      code: "unit_identifier_missing",
      severity: "warning",
      message: `${skippedRows} price row(s) had no usable unit identifier and were skipped.`,
      payload: { rows: skippedRows },
    });
  }
  if (invalidPrices > 0) {
    warnings.push({
      entity: "price",
      field: "price",
      code: "price_invalid",
      severity: "warning",
      message: `${invalidPrices} price row(s) had a zero, negative, or non-numeric price; the price was omitted.`,
      payload: { rows: invalidPrices },
    });
  }
  if (unsupportedCurrencies > 0) {
    warnings.push({
      entity: "price",
      field: "currency",
      code: "currency_unsupported",
      severity: "warning",
      message: `${unsupportedCurrencies} price row(s) stated an unsupported currency; it was not used.`,
      payload: { rows: unsupportedCurrencies },
    });
  }
  if (invalidSourceFacts > 0) {
    warnings.push({
      entity: "project",
      code: "source_fact_invalid",
      severity: "warning",
      message: `${invalidSourceFacts} extracted fact(s) had a placeholder value, unsupported confidence, or missing source reference and were not used.`,
      payload: { facts: invalidSourceFacts },
    });
  }

  return {
    priceList: { ...priceList, price_list_date: priceListDate, unit_inventory: rows },
    warnings,
    skippedRows,
  };
}
