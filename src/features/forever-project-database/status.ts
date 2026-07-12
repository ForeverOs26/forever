/**
 * Forever Canonical Project Database — standing vocabularies.
 *
 * Two closed vocabularies of RC4.6's own, plus one reused: a
 * {@link ProjectValueStatus} records where one canonical value stands —
 * current, superseded by a later reading, removed from the canonical record,
 * explicitly missing (a source was read and the value was not there), or
 * explicitly unknown (never yet observed at all) — so absence is always a
 * stated fact rather than silence. A {@link ProjectRecordStatus} records
 * where the whole canonical record stands. The per-field validation standing
 * *is* the RC4.5 validation-status vocabulary, reused rather than restated.
 *
 * Deliberately distinct from the RC4.5 `ExtractionFactStatus` (the standing
 * of one *extracted reading*) and the RC4.4 `ProjectSourceStatus` (the
 * standing of a catalogued *document*): a canonical value's standing is its
 * own question. RC4.6 transitions nothing — it defines the vocabularies and
 * pure predicates so validation and a future runtime can reason about
 * standing, and it flags contradictory combinations in validation rather
 * than resolving them.
 */

import type { ExtractionValidationStatus } from "@/features/forever-extraction-pipeline";

/** Where one canonical value currently stands. */
export type ProjectValueStatus = "current" | "superseded" | "removed" | "missing" | "unknown";

/** Every {@link ProjectValueStatus}, in a stable declared order. */
export const PROJECT_VALUE_STATUSES = [
  "current",
  "superseded",
  "removed",
  "missing",
  "unknown",
] as const satisfies readonly ProjectValueStatus[];

/** Runtime guard: whether a value is a known {@link ProjectValueStatus}. */
export function isKnownProjectValueStatus(value: unknown): value is ProjectValueStatus {
  return typeof value === "string" && (PROJECT_VALUE_STATUSES as readonly string[]).includes(value);
}

/** Whether a status marks the standing canonical value of its field. */
export function isCurrentProjectValueStatus(status: ProjectValueStatus): boolean {
  return status === "current";
}

/**
 * Whether a status permits the entry to carry a value representation at all.
 * A current value carries the canonical reading, and a superseded or removed
 * one keeps the reading it once was — history preserves what stood, even
 * after it was replaced or removed. Missing and unknown entries state an
 * absence that was never a reading — a value on one of those is a
 * fabrication, flagged by validation.
 */
export function projectValueStatusCarriesValue(status: ProjectValueStatus): boolean {
  return status === "current" || status === "superseded" || status === "removed";
}

/** Where one whole canonical project record currently stands. */
export type ProjectRecordStatus = "draft" | "active" | "archived";

/** Every {@link ProjectRecordStatus}, in a stable declared order. */
export const PROJECT_RECORD_STATUSES = [
  "draft",
  "active",
  "archived",
] as const satisfies readonly ProjectRecordStatus[];

/** Runtime guard: whether a value is a known {@link ProjectRecordStatus}. */
export function isKnownProjectRecordStatus(value: unknown): value is ProjectRecordStatus {
  return (
    typeof value === "string" && (PROJECT_RECORD_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * What the validation pipeline last concluded about one canonical field.
 * Reuses the RC4.5 vocabulary so a field reports validation standing exactly
 * the way an extracted fact does — one vocabulary, one guard.
 */
export type ProjectFieldValidationStatus = ExtractionValidationStatus;

// Reuse the RC4.5 vocabulary list and guard under canonical-database names —
// never a local variant.
export {
  EXTRACTION_VALIDATION_STATUSES as PROJECT_FIELD_VALIDATION_STATUSES,
  isKnownExtractionValidationStatus as isKnownProjectFieldValidationStatus,
} from "@/features/forever-extraction-pipeline";
