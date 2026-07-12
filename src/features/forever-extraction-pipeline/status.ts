/**
 * Forever Extraction Pipeline — fact lifecycle vocabularies.
 *
 * Three closed vocabularies keep a fact's lifecycle unambiguous, each
 * answering one question. {@link ExtractionFactStatus} records where the fact
 * *stands*: freshly extracted, verified against its source, disputed by a
 * conflicting fact, superseded by a re-extraction, or explicitly unavailable
 * — the source was read and the fact was not there, so its absence is a
 * stated fact rather than silence. {@link ExtractionReviewStatus} records
 * where a human review stands, and {@link ExtractionValidationStatus} records
 * what the validation pipeline last concluded.
 *
 * Deliberately distinct from the RC4.4 {@link ProjectSourceStatus} (the
 * standing of a catalogued *document*) and from the RC3.0
 * `VerificationStatus` (the binary verification of a canonical record) — a
 * fact's standing is its own question. RC4.5 transitions nothing: it defines
 * the vocabularies and pure predicates so validation and a future runtime can
 * reason about a fact's standing, and it flags contradictory combinations in
 * validation rather than resolving them.
 */

/** Where one extracted fact currently stands. */
export type ExtractionFactStatus =
  | "extracted"
  | "verified"
  | "disputed"
  | "superseded"
  | "unavailable";

/** Every {@link ExtractionFactStatus}, in a stable declared order. */
export const EXTRACTION_FACT_STATUSES = [
  "extracted",
  "verified",
  "disputed",
  "superseded",
  "unavailable",
] as const satisfies readonly ExtractionFactStatus[];

/**
 * Whether a status marks a fact as current — still the standing reading of
 * its subject, rather than replaced by a later extraction attempt.
 */
export function isCurrentExtractionFactStatus(status: ExtractionFactStatus): boolean {
  return status !== "superseded";
}

/** Whether a status marks a fact as carrying a value at all. */
export function extractionFactStatusCarriesValue(status: ExtractionFactStatus): boolean {
  return status !== "unavailable";
}

/** Runtime guard: whether a value is a known {@link ExtractionFactStatus}. */
export function isKnownExtractionFactStatus(value: unknown): value is ExtractionFactStatus {
  return (
    typeof value === "string" && (EXTRACTION_FACT_STATUSES as readonly string[]).includes(value)
  );
}

/** Where the human review of one fact currently stands. */
export type ExtractionReviewStatus = "unreviewed" | "in_review" | "approved" | "rejected";

/** Every {@link ExtractionReviewStatus}, in a stable declared order. */
export const EXTRACTION_REVIEW_STATUSES = [
  "unreviewed",
  "in_review",
  "approved",
  "rejected",
] as const satisfies readonly ExtractionReviewStatus[];

/** Runtime guard: whether a value is a known {@link ExtractionReviewStatus}. */
export function isKnownExtractionReviewStatus(value: unknown): value is ExtractionReviewStatus {
  return (
    typeof value === "string" && (EXTRACTION_REVIEW_STATUSES as readonly string[]).includes(value)
  );
}

/** What the validation pipeline last concluded about one fact. */
export type ExtractionValidationStatus = "unvalidated" | "valid" | "invalid";

/** Every {@link ExtractionValidationStatus}, in a stable declared order. */
export const EXTRACTION_VALIDATION_STATUSES = [
  "unvalidated",
  "valid",
  "invalid",
] as const satisfies readonly ExtractionValidationStatus[];

/** Runtime guard: whether a value is a known {@link ExtractionValidationStatus}. */
export function isKnownExtractionValidationStatus(
  value: unknown,
): value is ExtractionValidationStatus {
  return (
    typeof value === "string" &&
    (EXTRACTION_VALIDATION_STATUSES as readonly string[]).includes(value)
  );
}
