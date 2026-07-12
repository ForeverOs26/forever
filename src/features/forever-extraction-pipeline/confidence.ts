/**
 * Forever Extraction Pipeline — extraction confidence.
 *
 * An {@link ExtractionConfidence} grades how sure the extraction that produced
 * a fact was of what it read. The ladder is graded from `unknown` up to
 * `certain`, and `unknown` is a first-class rung: a fact whose confidence was
 * never assessed says so explicitly, and may never carry a numeric score —
 * unknown confidence stays unknown, never fabricated (anti-fabrication). The
 * optional score follows the RC3.0 `SourceMetadata` convention of a `0..1`
 * confidence number, so a graded fact lines up with the canonical records it
 * will later evidence.
 *
 * Deliberately distinct from the RC3.3 {@link SourceTrustLevel} reused by the
 * RC4.4 authority: trust grades *who stands behind a document*, confidence
 * grades *how surely one value was read out of it* — the two answer different
 * questions and must not be conflated. RC4.5 assesses nothing; callers supply
 * every grade.
 */

/** How sure an extraction was of a fact, from unassessed to certain. */
export type ExtractionConfidenceLevel = "unknown" | "low" | "medium" | "high" | "certain";

/** Every {@link ExtractionConfidenceLevel}, least confident first. */
export const EXTRACTION_CONFIDENCE_LEVELS = [
  "unknown",
  "low",
  "medium",
  "high",
  "certain",
] as const satisfies readonly ExtractionConfidenceLevel[];

/** Rank of each confidence level; a higher number is more confident. */
const EXTRACTION_CONFIDENCE_RANK: Record<ExtractionConfidenceLevel, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
  certain: 4,
};

/** The rank of a confidence level; higher means more confident. */
export function extractionConfidenceRank(level: ExtractionConfidenceLevel): number {
  return EXTRACTION_CONFIDENCE_RANK[level];
}

/**
 * Whether `actual` meets or exceeds a `required` confidence level. An
 * `unknown` grade meets only an `unknown` requirement — never a graded bar.
 */
export function meetsExtractionConfidence(
  actual: ExtractionConfidenceLevel,
  required: ExtractionConfidenceLevel,
): boolean {
  return EXTRACTION_CONFIDENCE_RANK[actual] >= EXTRACTION_CONFIDENCE_RANK[required];
}

/**
 * Comparator ordering confidence levels most-confident first.
 *
 * Suitable for `Array.prototype.sort`: negative when `a` is more confident
 * than `b`. Pure and total.
 */
export function compareExtractionConfidence(
  a: ExtractionConfidenceLevel,
  b: ExtractionConfidenceLevel,
): number {
  return EXTRACTION_CONFIDENCE_RANK[b] - EXTRACTION_CONFIDENCE_RANK[a];
}

/** Runtime guard: whether a value is a known {@link ExtractionConfidenceLevel}. */
export function isKnownExtractionConfidenceLevel(
  value: unknown,
): value is ExtractionConfidenceLevel {
  return (
    typeof value === "string" && (EXTRACTION_CONFIDENCE_LEVELS as readonly string[]).includes(value)
  );
}

/** How sure the extraction that produced one fact was of what it read. */
export interface ExtractionConfidence {
  level: ExtractionConfidenceLevel;
  /**
   * Numeric confidence in the RC3.0 `0..1` convention, when one was assessed.
   * Never present on an `unknown` grade — an unassessed confidence carries no
   * number.
   */
  score?: number;
}

/** The explicit unassessed confidence: `unknown`, with no score. */
export function unknownExtractionConfidence(): ExtractionConfidence {
  return { level: "unknown" };
}

/** Options accepted by {@link extractionConfidence}. */
export interface ExtractionConfidenceOptions {
  /** Numeric `0..1` score; attached only when supplied (anti-fabrication). */
  score?: number;
}

/**
 * Build an {@link ExtractionConfidence}; the score is attached only when
 * supplied so an unassessed number stays absent. Validation — not this
 * builder — judges whether a score is coherent with its level.
 */
export function extractionConfidence(
  level: ExtractionConfidenceLevel,
  options: ExtractionConfidenceOptions = {},
): ExtractionConfidence {
  const confidence: ExtractionConfidence = { level };
  if (options.score !== undefined) confidence.score = options.score;
  return confidence;
}
