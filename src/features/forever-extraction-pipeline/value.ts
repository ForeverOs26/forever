/**
 * Forever Extraction Pipeline — value models.
 *
 * The vocabulary that keeps a fact's representations clearly apart: the *raw*
 * value is the text exactly as observed in the source, the *structured* value
 * is its typed counterpart, and a *derived* value is one a future runtime
 * computed from other facts. RC4.5 computes and normalizes nothing — a fact
 * described here can *say* it is derived (and chain to what it was derived
 * from through its provenance), but no derivation is ever performed.
 *
 * Structured values reuse the RC3.0 canonical shapes where one exists: a
 * monetary fact is an RC3.0 {@link Money}, a coordinates fact an RC3.0
 * {@link GeoPoint} — never a parallel shape. Everything else is a scalar or a
 * list of scalars, so a structured value stays plain, comparable data.
 */

import type { GeoPoint, Money } from "@/features/forever-database";

/**
 * How a fact's carried value came to be.
 *
 * `raw` carries only the text as observed, `structured` also carries a typed
 * counterpart, and `derived` marks a value a future runtime computed from
 * other facts — described here, never calculated.
 */
export type ExtractionValueKind = "raw" | "structured" | "derived";

/** Every {@link ExtractionValueKind}, in a stable declared order. */
export const EXTRACTION_VALUE_KINDS = [
  "raw",
  "structured",
  "derived",
] as const satisfies readonly ExtractionValueKind[];

/** Runtime guard: whether a value is a known {@link ExtractionValueKind}. */
export function isKnownExtractionValueKind(value: unknown): value is ExtractionValueKind {
  return typeof value === "string" && (EXTRACTION_VALUE_KINDS as readonly string[]).includes(value);
}

/** A plain scalar a structured value is composed of. */
export type ExtractionScalar = string | number | boolean;

/**
 * The typed counterpart of a raw value: a scalar, a list of scalars, an RC3.0
 * {@link Money}, or an RC3.0 {@link GeoPoint}.
 */
export type ExtractionStructuredValue = ExtractionScalar | ExtractionScalar[] | Money | GeoPoint;

/** Runtime guard: whether a value is an {@link ExtractionScalar}. */
export function isExtractionScalar(value: unknown): value is ExtractionScalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isMoney(value: object): value is Money {
  const candidate = value as Partial<Money>;
  return (
    typeof candidate.amount === "number" &&
    typeof candidate.currency === "string" &&
    Object.keys(value).length === 2
  );
}

function isGeoPoint(value: object): value is GeoPoint {
  const candidate = value as Partial<GeoPoint>;
  return (
    typeof candidate.latitude === "number" &&
    typeof candidate.longitude === "number" &&
    Object.keys(value).length === 2
  );
}

/** Runtime guard: whether a value is a well-formed {@link ExtractionStructuredValue}. */
export function isExtractionStructuredValue(value: unknown): value is ExtractionStructuredValue {
  if (isExtractionScalar(value)) return true;
  if (Array.isArray(value)) return value.every(isExtractionScalar);
  if (typeof value === "object" && value !== null) {
    return isMoney(value) || isGeoPoint(value);
  }
  return false;
}
