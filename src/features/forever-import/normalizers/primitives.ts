/**
 * Forever Import — primitive normalizers.
 *
 * Pure, deterministic coercions from loosely-typed source values into the
 * canonical primitives the Forever Database expects. Every helper is total and
 * side-effect free: it never throws, never reads a clock or locale, and returns
 * `undefined` for an absent or unparseable value so absent facts stay absent.
 */

import {
  DEFAULT_CURRENCY,
  type CurrencyCode,
  type ISODate,
  type Money,
} from "@/features/forever-database";

/** Trim and collapse internal whitespace; `undefined` when the result is empty. */
export function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Coerce a number or numeric string into a finite number.
 *
 * Spaces and thousands-separating commas are stripped; anything that is not a
 * clean decimal afterwards yields `undefined`. Booleans and other types are
 * never treated as numbers.
 */
export function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/[\s,]/g, "");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Build a positive {@link Money} from an amount and optional currency.
 *
 * Mirrors the Forever Database rule that a zero or negative amount is an absent
 * price, not a real one. Currency is upper-cased when it is a valid 3-letter
 * code, else the caller-provided default is used.
 */
export function normalizeMoney(
  amount: unknown,
  currency?: unknown,
  defaultCurrency: CurrencyCode = DEFAULT_CURRENCY,
): Money | undefined {
  const n = normalizeNumber(amount);
  if (n === undefined || n <= 0) return undefined;
  const code = normalizeString(currency);
  const resolved = code && /^[A-Za-z]{3}$/.test(code) ? code.toUpperCase() : defaultCurrency;
  return { amount: n, currency: resolved };
}

/**
 * Interpret a truthy/falsy source value as a boolean.
 *
 * Recognises native booleans, `0`/`1`, and a fixed set of English words. An
 * unrecognised value returns `undefined` rather than guessing.
 */
export function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  const token = normalizeString(value)?.toLowerCase();
  if (token === undefined) return undefined;
  if (["true", "yes", "y", "1"].includes(token)) return true;
  if (["false", "no", "n", "0"].includes(token)) return false;
  return undefined;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const max = month === 2 && !isLeap ? 28 : DAYS_IN_MONTH[month - 1];
  return day <= max;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * Parse a calendar date into canonical ISO `YYYY-MM-DD`.
 *
 * Accepts `YYYY-MM-DD` / `YYYY/MM/DD` (optionally with a time suffix that is
 * dropped) and the common `DD.MM.YYYY` / `DD/MM/YYYY` forms. Parsing is
 * manual and timezone-free so the result never shifts by a day; an impossible
 * or unrecognised date yields `undefined`.
 */
export function normalizeDate(value: unknown): ISODate | undefined {
  const raw = normalizeString(value);
  if (raw === undefined) return undefined;

  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(raw);
  if (iso) {
    const [, y, m, d] = iso;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if (!isValidYmd(year, month, day)) return undefined;
    return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  }

  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(raw);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if (!isValidYmd(year, month, day)) return undefined;
    return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  }

  return undefined;
}

/**
 * Validate and trim an absolute `http`/`https` URL.
 *
 * The foundation never dereferences the URL — it only confirms the string is a
 * well-formed absolute web URL. Relative URLs and other schemes (`ftp:`,
 * `javascript:`) are rejected. The original string is preserved verbatim when
 * valid so query strings and casing are never mangled.
 */
export function normalizeUrl(value: unknown): string | undefined {
  const raw = normalizeString(value);
  if (raw === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  return raw;
}
