/**
 * Forever Database — deterministic normalizers.
 *
 * Pure, side-effect-free helpers shared by adapters and validation. Given the
 * same input they always return the same output: no randomness, no clocks, no
 * locale-dependent behavior. Extracting them here prevents the normalization
 * logic from being duplicated across future stage adapters.
 */

import { DEFAULT_CURRENCY, type CurrencyCode, type Money } from "./models/common";
import type {
  ConstructionStatus,
  OwnershipType,
  ProjectPublicStatus,
  SalesStatus,
  UnitAvailabilityStatus,
} from "./models/enums";

/** Collapse whitespace and lowercase for deterministic keyword matching. */
function canonical(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Deterministically derive a URL-safe slug from a name.
 *
 * Lowercase, ASCII-alphanumeric words joined by single hyphens. Diacritics
 * are stripped via Unicode decomposition so the result is stable and safe.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Trim a string; return `undefined` when it is empty (an absent fact). */
export function optionalString(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Return a finite number, or `undefined` for null/NaN/non-finite input. */
export function optionalNumber(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Return a strictly-positive finite number, or `undefined`.
 *
 * Used for scores and per-sqm values where the existing view model uses `0`
 * as a "not set" sentinel; surfacing that 0 would be a misleading fact.
 */
export function optionalPositiveNumber(value: number | null | undefined): number | undefined {
  const n = optionalNumber(value);
  if (n === undefined || n <= 0) return undefined;
  return n;
}

/**
 * Return a positive `Money`, or `undefined`.
 *
 * A zero or negative amount is treated as an absent price: the existing view
 * model uses `0` to mean "no starting price", and the Data Standard requires
 * absent facts to remain absent rather than surfacing a misleading 0.
 */
export function optionalMoney(
  amount: number | null | undefined,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): Money | undefined {
  const n = optionalNumber(amount);
  if (n === undefined || n <= 0) return undefined;
  return { amount: n, currency };
}

export function normalizePublicStatus(raw: string): ProjectPublicStatus {
  const v = canonical(raw);
  if (!v) return "unknown";
  if (v.includes("draft")) return "draft";
  if (v.includes("archiv")) return "archived";
  if (v.includes("active") || v.includes("available") || v.includes("published")) return "active";
  return "unknown";
}

export function normalizeSalesStatus(raw: string): SalesStatus {
  const v = canonical(raw);
  if (!v) return "unknown";
  if (v.includes("sold out") || v.includes("sold-out") || v === "sold") return "sold_out";
  if (v.includes("coming")) return "coming_soon";
  if (v.includes("resale")) return "resale";
  if (v.includes("available") || v.includes("for sale") || v.includes("selling"))
    return "available";
  return "unknown";
}

export function normalizeConstructionStatus(raw: string): ConstructionStatus {
  const v = canonical(raw);
  if (!v) return "unknown";
  if (v.includes("complet") || v.includes("ready") || v.includes("finished")) return "completed";
  if (v.includes("under construction") || v.includes("building") || v.includes("progress"))
    return "under_construction";
  if (v.includes("planning") || v.includes("pre-construction") || v.includes("planned"))
    return "planning";
  return "unknown";
}

export function normalizeOwnershipType(raw: string): OwnershipType {
  const v = canonical(raw);
  if (!v) return "unknown";
  const hasFreehold = v.includes("freehold");
  const hasLeasehold = v.includes("leasehold");
  if (hasFreehold && hasLeasehold) return "mixed";
  if (hasFreehold) return "freehold";
  if (hasLeasehold) return "leasehold";
  if (v.includes("mixed")) return "mixed";
  return "unknown";
}

export function normalizeAvailabilityStatus(raw: string): UnitAvailabilityStatus {
  const v = canonical(raw);
  if (!v) return "unknown";
  if (v.includes("reserv")) return "reserved";
  if (v.includes("sold")) return "sold";
  if (v.includes("unavailable") || v.includes("not available")) return "unavailable";
  if (v.includes("available") || v.includes("free")) return "available";
  return "unknown";
}
