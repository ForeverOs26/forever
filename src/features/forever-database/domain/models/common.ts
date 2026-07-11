/**
 * Forever Database — shared primitive types.
 *
 * These are the reusable building blocks every canonical Forever Database
 * entity is composed from. They are intentionally source-agnostic: the
 * database foundation must be usable by future automation, import pipelines,
 * Discovery, Navigator, and Marketplace without depending on any particular
 * data source or UI view model.
 *
 * Absent facts must remain absent. Optional fields are `?`-optional and are
 * omitted (never coerced to `0`, `""`, or a placeholder) when a fact is not
 * present in the source.
 */

/** Stable identifier for a canonical record. */
export type ForeverId = string;

/** URL- and file-safe identifier derived deterministically from a name. */
export type Slug = string;

/** Calendar date normalized to ISO `YYYY-MM-DD`. */
export type ISODate = string;

/** Full ISO-8601 timestamp. */
export type ISODateTime = string;

/** ISO-4217 three-letter currency code, e.g. `THB`. */
export type CurrencyCode = string;

/**
 * Default project currency for Phuket imports, per the Forever Data Standard.
 * Used only where a currency is required and the source proves no other.
 */
export const DEFAULT_CURRENCY: CurrencyCode = "THB";

/** A monetary amount paired with its currency. */
export interface Money {
  amount: number;
  currency: CurrencyCode;
}

/** A geographic coordinate. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * Provenance for a single imported record or fact.
 *
 * Every canonical record may carry source metadata so future Knowledge and
 * AI Factory workflows can trace a fact back to its evidence without touching
 * production data. All fields are optional — provenance is additive.
 */
export interface SourceMetadata {
  /** Human/system label for the source, e.g. `developer_price_list`. */
  sourceLabel?: string;
  sourceFile?: string;
  sourcePage?: number;
  sourceDate?: ISODate;
  extractedAt?: ISODateTime;
  /** Extraction confidence in the range 0..1. */
  confidence?: number;
  /** Raw extracted values, preserved verbatim. */
  raw?: Record<string, unknown>;
}

/**
 * Optional lifecycle timestamps.
 *
 * Deliberately optional so pure, deterministic mapping outputs can omit them:
 * identical inputs must produce identical records. Timestamps are supplied by
 * persistence/import layers, never by the adapters.
 */
export interface AuditFields {
  createdAt?: ISODateTime;
  updatedAt?: ISODateTime;
}

/** Verification lifecycle shared by developers, documents, and media. */
export type VerificationStatus = "unverified" | "pending" | "verified";
